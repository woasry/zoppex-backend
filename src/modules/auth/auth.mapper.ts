import { Organization } from '@prisma/client';
import { AuthenticatedUser } from '../../common/interfaces/request-context.interface';
import { AuthResponseDto, MeResponseDto } from './dto/response.dto';

export interface AuthResultShape {
  accessToken: string;
  user: AuthenticatedUser;
}

function toUserResponse(user: AuthenticatedUser): AuthResponseDto['user'] {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
}

function toMembershipsResponse(user: AuthenticatedUser): AuthResponseDto['memberships'] {
  return user.memberships.map((membership) => ({
    id: membership.id,
    role: membership.role,
    organization: toOrganizationResponse(membership.organization),
  }));
}

function toOrganizationResponse(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    location: organization.location,
    contactEmail: organization.contactEmail,
    timezone: organization.timezone,
  };
}

export function toAuthResponse(result: AuthResultShape): AuthResponseDto {
  return {
    accessToken: result.accessToken,
    user: toUserResponse(result.user),
    memberships: toMembershipsResponse(result.user),
  };
}

export function toMeResponse(user: AuthenticatedUser): MeResponseDto {
  return {
    user: toUserResponse(user),
    memberships: toMembershipsResponse(user),
  };
}
