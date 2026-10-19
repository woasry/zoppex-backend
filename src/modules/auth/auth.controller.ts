import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AppConfig } from '../../config/configuration';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JwtPayload } from '../../common/interfaces/request-context.interface';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthResponseDto, MeResponseDto, MessageResponseDto } from './dto/response.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AcceptInvitationService } from './accept-invitation.service';
import { ConfigService } from '@nestjs/config';

export const REFRESH_COOKIE_NAME = 'zoppex_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly acceptInvitationService: AcceptInvitationService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Create an account with a new organization (14-day trial)' })
  @ApiOkResponse({ type: AuthResponseDto })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.register(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return this.toAuthResponse(result);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const result = await this.authService.login(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return this.toAuthResponse(result);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  @ApiOkResponse({ type: AuthResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException('Refresh token cookie is missing');
    }
    const result = await this.authService.refresh(token);
    this.setRefreshCookie(res, result.refreshToken);
    return this.toAuthResponse(result);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current refresh token and clear the cookie' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<MessageResponseDto> {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (token) {
      await this.authService.logout(token);
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
    return { message: 'Signed out' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user with their memberships' })
  @ApiOkResponse({ type: MeResponseDto })
  async me(@CurrentUser() user: JwtPayload): Promise<MeResponseDto> {
    const authenticated = await this.authService.getAuthenticatedUser(user.sub);
    return this.toMeResponse(authenticated);
  }

  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify an email address with a token from the verification email' })
  @ApiOkResponse({ type: MessageResponseDto })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponseDto> {
    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified' };
  }

  @Post('resend-verification')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend the email verification link' })
  @ApiOkResponse({ type: MessageResponseDto })
  async resendVerification(@CurrentUser() user: JwtPayload): Promise<MessageResponseDto> {
    await this.authService.resendVerification(user.sub);
    return { message: 'Verification email sent' };
  }

  @Post('invitations/accept')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept a team invitation with a token from the email link' })
  @ApiOkResponse({ type: MessageResponseDto })
  async acceptInvitation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AcceptInvitationDto,
  ): Promise<MessageResponseDto> {
    const organization = await this.acceptInvitationService.accept(user.sub, dto.token);
    return { message: `You have joined ${organization.name}` };
  }

  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a password reset link (always succeeds)' })
  @ApiOkResponse({ type: MessageResponseDto })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If an account exists for this email, a reset link has been sent' };
  }

  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  @ApiOkResponse({ type: MessageResponseDto })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponseDto> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password updated' };
  }

  private setRefreshCookie(res: Response, token: string): void {
    const isProduction = this.configService.get('nodeEnv', { infer: true }) === 'production';
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/auth',
    });
  }

  private toAuthResponse(result: {
    accessToken: string;
    user: Awaited<ReturnType<AuthService['getAuthenticatedUser']>>;
  }): AuthResponseDto {
    return {
      accessToken: result.accessToken,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        emailVerifiedAt: result.user.emailVerifiedAt?.toISOString() ?? null,
      },
      memberships: result.user.memberships.map((membership) => ({
        id: membership.id,
        role: membership.role,
        organization: this.toOrganizationResponse(membership.organization),
      })),
    };
  }

  private toMeResponse(user: Awaited<ReturnType<AuthService['getAuthenticatedUser']>>): MeResponseDto {
    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      },
      memberships: user.memberships.map((membership) => ({
        id: membership.id,
        role: membership.role,
        organization: this.toOrganizationResponse(membership.organization),
      })),
    };
  }

  private toOrganizationResponse(organization: {
    id: string;
    name: string;
    location: string | null;
    contactEmail: string | null;
    timezone: string;
  }) {
    return {
      id: organization.id,
      name: organization.name,
      location: organization.location,
      contactEmail: organization.contactEmail,
      timezone: organization.timezone,
    };
  }
}
