import { Controller, Param, Query, Sse, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MessageEvent } from '@nestjs/common';
import { JwtPayload } from '../../common/interfaces/request-context.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

@ApiTags('realtime')
@Controller('realtime')
export class RealtimeController {
  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  @Sse('organization')
  @ApiOperation({ summary: 'Live events for an organization dashboard (token via query param)' })
  streamOrganization(
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
    return this.prisma.membership
      .findUnique({
        where: {
          userId_organizationId: {
            userId: payload.sub,
            organizationId,
          },
        },
      })
      .then((membership) => {
        if (!membership) {
          throw new UnauthorizedException('No access to this organization');
        }
        return this.realtimeService.streamOrganization(organizationId);
      });
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
