import { User, Organization, MemberRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface OrganizationContext {
  organization: Organization;
  role: MemberRole;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  emailVerifiedAt: Date | null;
  memberships: {
    id: string;
    role: MemberRole;
    organization: Organization;
  }[];
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      organizationContext?: OrganizationContext;
    }
  }
}
