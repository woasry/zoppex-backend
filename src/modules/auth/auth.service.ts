import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { AppConfig } from '../../config/configuration';
import { AuthenticatedUser, JwtPayload } from '../../common/interfaces/request-context.interface';
import { EmailService } from '../notifications/email.service';
import { renderPasswordResetEmail, renderVerificationEmail } from '../notifications/email-templates';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { EMAIL_VERIFICATION_TTL_HOURS, PASSWORD_RESET_TTL_HOURS, parseDurationToMs } from './auth.constants';

interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly organizationsService: OrganizationsService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });
    const organization = await this.organizationsService.createWithOwner(
      user.id,
      { name: dto.organizationName, location: dto.location, contactEmail: dto.email },
      this.configService.get('trialDays', { infer: true }),
    );
    await this.sendVerificationEmail(user.id, user.email, user.firstName);
    return this.buildAuthResult(user.id, organization.id);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    if (memberships.length === 0) {
      throw new UnauthorizedException('This account has no workspace access');
    }
    return this.buildAuthResult(user.id, memberships[0].organizationId);
  }

  async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser as AuthenticatedUser;
  }

  async refresh(token: string): Promise<AuthResult> {
    const tokenHash = this.hashToken(token);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    const memberships = await this.prisma.membership.findMany({
      where: { userId: stored.userId },
      orderBy: { createdAt: 'asc' },
    });
    if (memberships.length === 0) {
      throw new UnauthorizedException('This account has no workspace access');
    }
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.buildAuthResult(stored.userId, memberships[0].organizationId);
  }

  async logout(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const stored = await this.prisma.verificationToken.findUnique({
      where: { token },
    });
    if (!stored || stored.type !== 'EMAIL_VERIFICATION') {
      throw new BadRequestException('Invalid verification link');
    }
    if (stored.expiresAt < new Date()) {
      await this.prisma.verificationToken.delete({ where: { id: stored.id } });
      throw new BadRequestException('This verification link has expired');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.verificationToken.delete({ where: { id: stored.id } }),
    ]);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Email is already verified');
    }
    await this.sendVerificationEmail(user.id, user.email, user.firstName);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }
    const token = randomBytes(32).toString('hex');
    await this.prisma.verificationToken.upsert({
      where: { userId_type: { userId: user.id, type: 'PASSWORD_RESET' } },
      update: {
        token,
        expiresAt: this.expiryDate(PASSWORD_RESET_TTL_HOURS),
      },
      create: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        token,
        expiresAt: this.expiryDate(PASSWORD_RESET_TTL_HOURS),
      },
    });
    const url = this.buildUrl(`/reset-password?token=${token}`);
    await this.emailService.send({
      to: user.email,
      template: renderPasswordResetEmail(user.firstName, url),
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const stored = await this.prisma.verificationToken.findUnique({
      where: { token },
    });
    if (!stored || stored.type !== 'PASSWORD_RESET') {
      throw new BadRequestException('Invalid reset link');
    }
    if (stored.expiresAt < new Date()) {
      await this.prisma.verificationToken.delete({ where: { id: stored.id } });
      throw new BadRequestException('This reset link has expired');
    }
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
      this.prisma.verificationToken.delete({ where: { id: stored.id } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async sendVerificationEmail(userId: string, email: string, firstName: string): Promise<void> {
    const token = randomBytes(32).toString('hex');
    await this.prisma.verificationToken.upsert({
      where: { userId_type: { userId, type: 'EMAIL_VERIFICATION' } },
      update: {
        token,
        expiresAt: this.expiryDate(EMAIL_VERIFICATION_TTL_HOURS),
      },
      create: {
        userId,
        type: 'EMAIL_VERIFICATION',
        token,
        expiresAt: this.expiryDate(EMAIL_VERIFICATION_TTL_HOURS),
      },
    });
    const url = this.buildUrl(`/verify-email?token=${token}`);
    await this.emailService.send({
      to: email,
      template: renderVerificationEmail(firstName, url),
    });
  }

  private async buildAuthResult(userId: string, _organizationId: string): Promise<AuthResult> {
    const user = await this.getAuthenticatedUser(userId);
    const payload: JwtPayload = { sub: userId, email: user.email };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.issueRefreshToken(userId);
    return { accessToken, refreshToken, user };
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(48).toString('hex');
    const expiresIn = parseDurationToMs(
      this.configService.get('jwt.refreshExpiresIn', { infer: true }),
    );
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + expiresIn),
      },
    });
    return token;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private expiryDate(hours: number): Date {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private buildUrl(path: string): string {
    return `${this.configService.get('appUrl', { infer: true })}${path}`;
  }
}
