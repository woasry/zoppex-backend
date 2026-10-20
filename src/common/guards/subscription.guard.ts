import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { SubscriptionStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { JwtAuthGuard } from './jwt-auth.guard';
import { ORGANIZATION_HEADER } from './org-member.guard';

const ENTITLED_STATUSES = new Set<SubscriptionStatus>([
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
]);



@Injectable()
export class SubscriptionGuard extends JwtAuthGuard implements CanActivate {
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
      return false;
    }
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: request.user.sub,
          organizationId,
        },
      },
    });
    if (!membership) {
      return false;
    }
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (!subscription || !ENTITLED_STATUSES.has(subscription.status)) {
      throw new HttpException('Your trial or subscription has ended', HttpStatus.PAYMENT_REQUIRED);
    }
    return true;
  }
}
