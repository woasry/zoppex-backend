import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JoinQueueDto } from './dto/join-queue.dto';
import { JoinTicketResponseDto, PublicQueueInfoDto, TicketPositionDto } from '../queues/dto/response.dto';
import { TicketsService } from './tickets.service';

@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('queues/:queueId')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Public queue info for the guest join page' })
  @ApiOkResponse({ type: PublicQueueInfoDto })
  async getQueueInfo(
    @Param('queueId', ParseUUIDPipe) queueId: string,
  ): Promise<PublicQueueInfoDto> {
    return this.ticketsService.getPublicQueueInfo(queueId);
  }

  @Post('queues/:queueId/tickets')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Join a queue as a guest (no account required)' })
  @ApiOkResponse({ type: JoinTicketResponseDto })
  async joinQueue(
    @Param('queueId', ParseUUIDPipe) queueId: string,
    @Body() dto: JoinQueueDto,
  ): Promise<JoinTicketResponseDto> {
    return this.ticketsService.join(queueId, dto.displayName);
  }

  @Get('tickets/:ticketId')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Guest ticket live position and estimate' })
  @ApiOkResponse({ type: TicketPositionDto })
  async getTicket(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<TicketPositionDto> {
    return this.ticketsService.getTicketPosition(ticketId);
  }
}
