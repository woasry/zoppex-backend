import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { MemberRole, Organization } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { renderInvitationEmail } from '../notifications/email-templates';
import { CreateInvitationDto, UpdateOrganizationDto } from './dto/organizations.dto';

export const INVITATION_TTL_DAYS = 7;

export class MemberResponseDto {
  id: string;
  role: MemberRole;
  userId: string;
  firstName: string;
  lastName: string | null;
  email: string;
  joinedAt: Date;
}

export interface MemberResponse {
  id: string;
  role: MemberRole;
  userId: string;
  firstName: string;
  lastName: string | null;
  email: string;
  joinedAt: Date;
}

export class InvitationResponseDto {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
  createdAt: Date;
}

export interface InvitationResponse {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly emailService: EmailService,
  ) {}

  async update(
    organizationId: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: dto.name,
        location: dto.location,
        contactEmail: dto.contactEmail,
      },
    });
  }

  async listMembers(organizationId: string): Promise<MemberResponse[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      userId: membership.user.id,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      email: membership.user.email,
      joinedAt: membership.createdAt,
    }));
  }

  async removeMember(
    organizationId: string,
    membershipId: string,
  ): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
    });
    if (!membership || membership.organizationId !== organizationId) {
      throw new NotFoundException('Member not found');
    }
    if (membership.role === 'OWNER') {
      throw new ForbiddenException('The workspace owner cannot be removed');
    }
    await this.prisma.membership.delete({ where: { id: membershipId } });
  }

  async listInvitations(organizationId: string): Promise<InvitationResponse[]> {
    const invitations = await this.prisma.invitation.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gte: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    }));
  }

  async createInvitation(
    organizationId: string,
    inviterId: string,
    dto: CreateInvitationDto,
  ): Promise<InvitationResponse> {
    if (dto.role === 'OWNER') {
      throw new BadRequestException('Cannot invite someone as owner');
    }
    const maxMembers = this.configService.get('maxMembersPerOrg', { infer: true });
    const [memberCount, pendingCount] = await Promise.all([
      this.prisma.membership.count({ where: { organizationId } }),
      this.prisma.invitation.count({
        where: {
          organizationId,
          acceptedAt: null,
          expiresAt: { gte: new Date() },
        },
      }),
    ]);
    if (memberCount + pendingCount >= maxMembers) {
      throw new BadRequestException(
        `Your plan allows up to ${maxMembers} team members`,
      );
    }
    const existingMember = await this.prisma.membership.findFirst({
      where: {
        organizationId,
        user: { email: dto.email },
      },
    });
    if (existingMember) {
      throw new ConflictException('This person is already a member');
    }
    const pending = await this.prisma.invitation.findFirst({
      where: {
        organizationId,
        email: dto.email,
        acceptedAt: null,
        expiresAt: { gte: new Date() },
      },
    });
    if (pending) {
      throw new ConflictException('An invitation for this email is already pending');
    }
    const inviter = await this.prisma.user.findUnique({ where: { id: inviterId } });
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    const token = randomBytes(32).toString('hex');
    const invitation = await this.prisma.invitation.create({
      data: {
        organizationId,
        email: dto.email,
        role: dto.role,
        token,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        sentById: inviterId,
      },
    });
    const url = `${this.configService.get('appUrl', { infer: true })}/invite/${token}`;
    await this.emailService.send({
      to: dto.email,
      template: renderInvitationEmail(
        organization!.name,
        `${inviter!.firstName}${inviter!.lastName ? ` ${inviter!.lastName}` : ''}`,
        dto.role,
        url,
      ),
    });
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  }

  async revokeInvitation(organizationId: string, invitationId: string): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation || invitation.organizationId !== organizationId) {
      throw new NotFoundException('Invitation not found');
    }
    await this.prisma.invitation.delete({ where: { id: invitationId } });
  }

  async acceptInvitation(userId: string, token: string): Promise<Organization> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: { organization: true },
    });
    if (!invitation || invitation.acceptedAt) {
      throw new BadRequestException('This invitation is no longer valid');
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
    }
    const existing = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId: invitation.organizationId,
        },
      },
    });
    if (!existing) {
      await this.prisma.membership.create({
        data: {
          userId,
          organizationId: invitation.organizationId,
          role: invitation.role,
        },
      });
    }
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });
    return invitation.organization;
  }

  async createWithOwner(
    userId: string,
    data: { name: string; location?: string; contactEmail?: string },
    trialDays: number,
  ): Promise<Organization> {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: data.name,
          location: data.location,
          contactEmail: data.contactEmail,
        },
      });
      await tx.membership.create({
        data: {
          userId,
          organizationId: organization.id,
          role: 'OWNER',
        },
      });
      await tx.subscription.create({
        data: {
          organizationId: organization.id,
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
        },
      });
      return organization;
    });
  }

  async listForUser(userId: string): Promise<
    { id: string; role: string; organization: Organization }[]
  > {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      organization: membership.organization,
    }));
  }
}

