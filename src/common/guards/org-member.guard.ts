import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { OrganizationContext } from '../interfaces/request-context.interface';
import { MemberRole } from '@prisma/client';

export const ORGANIZATION_HEADER = 'x-organization-id';

@Injectable()
export class OrgMemberGuard extends JwtAuthGuard implements CanActivate {
  constructor(
    jwtService: JwtService,
    reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super(jwtService, reflector);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    super.canActivate(context);
    const request = context.switchToHttp().getRequest();
    const organizationId = request.headers[ORGANIZATION_HEADER];
    if (!organizationId || typeof organizationId !== 'string') {
      throw new BadRequestException('X-Organization-Id header is required');
    }
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: request.user.sub,
          organizationId,
        },
      },
      include: { organization: true },
    });
    if (!membership) {
      throw new ForbiddenException('You do not have access to this organization');
    }
    const requiredRoles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles && !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const organizationContext: OrganizationContext = {
      organization: membership.organization,
      role: membership.role,
    };
    request.organizationContext = organizationContext;
    return true;
  }
}
