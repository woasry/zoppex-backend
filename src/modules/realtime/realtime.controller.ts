import { Controller, Param, Query, Sse, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { MessageEvent } from '@nestjs/common';
import { JwtPayload } from '../../common/interfaces/request-context.interface';
import { RealtimeService } from './realtime.service';

@ApiTags('realtime')
@SkipThrottle()
@Controller('realtime')
export class RealtimeController {
  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly jwtService: JwtService,
  ) {}

  @Sse('organization')
  @ApiOperation({ summary: 'Live events for an organization dashboard (token via query param)' })
  async streamOrganization(
    @Query('token') token: string,
    @Query('organizationId') organizationId: string,
  ) {
    if (!token || !organizationId) {
      throw new UnauthorizedException('Token and organizationId query params are required');
    }
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const hasAccess = await this.realtimeService.hasOrganizationAccess(
      payload.sub,
      organizationId,
    );
    if (!hasAccess) {
      throw new UnauthorizedException('No access to this organization');
    }
    return this.realtimeService.streamOrganization(organizationId);
  }

  @Sse('public/queues/:queueId')
  @ApiOperation({ summary: 'Live events for a public queue page (anonymous)' })
  streamPublicQueue(@Param('queueId') queueId: string) {
    return this.realtimeService.streamQueue(queueId);
  }

  @Sse('public/tickets/:ticketId')
  @ApiOperation({ summary: 'Live events for a guest ticket page (anonymous)' })
  streamPublicTicket(@Param('ticketId') ticketId: string) {
    return this.realtimeService.streamTicket(ticketId);
  }
}

export type { MessageEvent };

