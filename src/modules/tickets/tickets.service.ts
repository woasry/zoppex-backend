import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Ticket } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { QueuesService } from '../queues/queues.service';
import { JoinTicketResponseDto, PublicQueueInfoDto, TicketPositionDto } from '../queues/dto/response.dto';

interface QueueRow {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  service: string;
  status: string;
  avgMinutes: number;
  desks: number;
  ticketSequence: number;
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly queuesService: QueuesService,
  ) {}

  async getPublicQueueInfo(queueId: string): Promise<PublicQueueInfoDto> {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      include: { organization: true },
    });
    if (!queue) {
      throw new NotFoundException('Queue not found');
    }
    const waitingCount = await this.prisma.ticket.count({
      where: { queueId, status: 'WAITING' },
    });
    return {
      queueId: queue.id,
      queueName: queue.name,
      organizationName: queue.organization.name,
      location: queue.organization.location,
      service: queue.service,
      status: queue.status,
      waitingCount,
      estimatedWaitMinutes: this.queuesService.estimateMinutes(
        waitingCount,
        queue.avgMinutes,
        queue.desks,
      ),
    };
  }

  async join(queueId: string, displayName?: string): Promise<JoinTicketResponseDto> {
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows = await tx.$queryRaw<QueueRow[]>(
        Prisma.sql`SELECT id, "organizationId", name, code, service, status, "avgMinutes", desks, "ticketSequence" FROM queues WHERE id = ${queueId} FOR UPDATE`,
      );
      if (rows.length === 0) {
        throw new NotFoundException('Queue not found');
      }
      const queue = rows[0];
      if (queue.status !== 'ACTIVE') {
        throw new ConflictException('This queue is temporarily paused');
      }
      const number = `${queue.code}${pad3(queue.ticketSequence)}`;
      const ticket = await tx.ticket.create({
        data: {
          queueId: queue.id,
          number,
          displayName: displayName?.trim() || null,
          status: 'WAITING',
        },
      });
      await tx.queue.update({
        where: { id: queue.id },
        data: { ticketSequence: { increment: 1 } },
      });
      await tx.activityEvent.create({
        data: {
          organizationId: queue.organizationId,
          queueId: queue.id,
          type: 'TICKET_JOINED',
          payload: { ticketNumber: number, queueName: queue.name },
        },
      });
      return { ticket, organizationId: queue.organizationId };
    });
    this.realtimeService.publishTicketUpdated(result.organizationId, queueId, result.ticket.id);
    this.realtimeService.publishQueueUpdated(result.organizationId, queueId);
    return { ticketId: result.ticket.id, number: result.ticket.number };
  }

  async getTicketPosition(ticketId: string): Promise<TicketPositionDto> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { queue: { include: { organization: true } } },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    const { queue } = ticket;
    const base: Omit<TicketPositionDto, 'peopleAhead' | 'estimatedWaitMinutes' | 'estimateRangeMinutes'> = {
      ticketId: ticket.id,
      number: ticket.number,
      status: ticket.status,
      queueName: queue.name,
      organizationName: queue.organization.name,
      queueStatus: queue.status,
    };
    if (ticket.status !== 'WAITING') {
      return {
        ...base,
        peopleAhead: 0,
        estimatedWaitMinutes: 0,
        estimateRangeMinutes: { low: 0, high: 0 },
      };
    }
    const ahead = await this.prisma.ticket.count({
      where: {
        queueId: queue.id,
        status: 'WAITING',
        joinedAt: { lt: ticket.joinedAt },
      },
    });
    const called = await this.prisma.ticket.findFirst({
      where: { queueId: queue.id, status: 'CALLED' },
      select: { id: true },
    });
    const peopleAhead = ahead + (called ? 1 : 0);
    const eta = Math.max(2, Math.ceil((ahead * queue.avgMinutes) / Math.max(1, queue.desks)));
    return {
      ...base,
      peopleAhead,
      estimatedWaitMinutes: eta,
      estimateRangeMinutes: { low: Math.max(1, eta - 2), high: eta + 3 },
    };
  }

  toTicketResponse(ticket: Ticket) {
    return this.queuesService.toTicketResponse(ticket);
  }
}
