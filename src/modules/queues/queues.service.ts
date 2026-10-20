import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Queue, QueueStatus, Ticket, TicketStatus } from '@prisma/client';

import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateQueueDto } from './dto/create-queue.dto';
import { UpdateQueueDto } from './dto/update-queue.dto';
import { QueueDetailDto, QueueWithStatsDto, TicketResponseDto } from './dto/response.dto';

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

const ESTIMATE_MIN_MINUTES = 2;
const ESTIMATE_RANGE_LOW_OFFSET = 2;
const ESTIMATE_RANGE_HIGH_OFFSET = 3;

function estimateMinutes(waitingCount: number, avgMinutes: number, desks: number): number {
  if (waitingCount === 0) {
    return 0;
  }
  return Math.max(ESTIMATE_MIN_MINUTES, Math.ceil((waitingCount * avgMinutes) / Math.max(1, desks)));
}


function toTicketResponse(ticket: Ticket): TicketResponseDto {
  return {
    id: ticket.id,
    queueId: ticket.queueId,
    number: ticket.number,
    displayName: ticket.displayName,
    status: ticket.status,
    joinedAt: ticket.joinedAt.toISOString(),
    calledAt: ticket.calledAt?.toISOString() ?? null,
    finishedAt: ticket.finishedAt?.toISOString() ?? null,
  };
}

function toQueueResponse(queue: Queue): Omit<QueueWithStatsDto, 'waitingCount' | 'estimatedWaitMinutes' | 'calledTicketNumber' | 'servedCount'> {
  return {
    id: queue.id,
    organizationId: queue.organizationId,
    name: queue.name,
    code: queue.code,
    service: queue.service,
    status: queue.status,
    avgMinutes: queue.avgMinutes,
    desks: queue.desks,
    createdAt: queue.createdAt.toISOString(),
    updatedAt: queue.updatedAt.toISOString(),
  };
}

@Injectable()
export class QueuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async list(organizationId: string): Promise<QueueWithStatsDto[]> {
    const queues = await this.prisma.queue.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: {
        tickets: {
          where: { status: { in: [TicketStatus.WAITING, TicketStatus.CALLED, TicketStatus.SERVED] } },
          select: { status: true, number: true },
        },
      },
    });
    return queues.map((queue) => {
      const waitingCount = queue.tickets.filter((t) => t.status === TicketStatus.WAITING).length;
      const called = queue.tickets.find((t) => t.status === TicketStatus.CALLED);
      const servedCount = queue.tickets.filter((t) => t.status === TicketStatus.SERVED).length;
      return {
        ...toQueueResponse(queue),
        waitingCount,
        estimatedWaitMinutes: estimateMinutes(waitingCount, queue.avgMinutes, queue.desks),
        calledTicketNumber: called?.number ?? null,
        servedCount,
      };
    });
  }

  async findDetail(organizationId: string, queueId: string): Promise<QueueDetailDto> {
    const queue = await this.getOrgQueue(organizationId, queueId);
    const tickets = await this.prisma.ticket.findMany({
      where: { queueId, status: { in: [TicketStatus.CALLED, TicketStatus.WAITING] } },
      orderBy: [{ status: 'desc' }, { joinedAt: 'asc' }],
    });
    const servedCount = await this.prisma.ticket.count({
      where: { queueId, status: TicketStatus.SERVED },
    });
    const waitingCount = tickets.filter((t) => t.status === TicketStatus.WAITING).length;
    const called = tickets.find((t) => t.status === TicketStatus.CALLED);
    return {
      ...toQueueResponse(queue),
      waitingCount,
      estimatedWaitMinutes: estimateMinutes(waitingCount, queue.avgMinutes, queue.desks),
      calledTicketNumber: called?.number ?? null,
      servedCount,
      tickets: tickets.map(toTicketResponse),
    };
  }

  async create(organizationId: string, dto: CreateQueueDto): Promise<QueueDetailDto> {
    const maxQueues = this.configService.get('maxQueuesPerOrg', { infer: true });
    const existingCount = await this.prisma.queue.count({ where: { organizationId } });
    if (existingCount >= maxQueues) {
      throw new BadRequestException(`Your plan allows up to ${maxQueues} queues`);
    }
    const queue = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const code = await this.nextCode(tx, organizationId);
      const created = await tx.queue.create({
        data: {
          organizationId,
          name: dto.name,
          code,
          service: dto.service ?? 'General service',
          avgMinutes: dto.avgMinutes ?? 5,
          desks: dto.desks ?? 1,
        },
      });
      await tx.activityEvent.create({
        data: {
          organizationId,
          queueId: created.id,
          type: 'QUEUE_CREATED',
          payload: { queueName: created.name },
        },
      });
      return created;
    });
    this.realtimeService.publishQueueUpdated(organizationId, queue.id);
    return this.findDetail(organizationId, queue.id);
  }

  async update(organizationId: string, queueId: string, dto: UpdateQueueDto): Promise<QueueDetailDto> {
    const queue = await this.getOrgQueue(organizationId, queueId);
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.queue.update({
        where: { id: queue.id },
        data: {
          service: dto.service,
          avgMinutes: dto.avgMinutes,
          desks: dto.desks,
        },
      });
      await tx.activityEvent.create({
        data: {
          organizationId,
          queueId: queue.id,
          type: 'QUEUE_UPDATED',
          payload: { queueName: queue.name, avgMinutes: dto.avgMinutes, desks: dto.desks },
        },
      });
    });
    this.realtimeService.publishQueueUpdated(organizationId, queue.id);
    return this.findDetail(organizationId, queue.id);
  }

  async callNext(organizationId: string, queueId: string): Promise<{ message: string; queue: QueueDetailDto }> {
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const queue = await this.lockQueue(tx, queueId);
      if (queue.organizationId !== organizationId) {
        throw new ForbiddenException('You do not have access to this queue');
      }
      if (queue.status !== QueueStatus.ACTIVE) {
        throw new ConflictException('Resume this queue first');
      }
      const current = await tx.ticket.findFirst({
        where: { queueId: queue.id, status: TicketStatus.CALLED },
      });
      if (current) {
        await tx.ticket.update({
          where: { id: current.id },
          data: { status: TicketStatus.SERVED, finishedAt: new Date() },
        });
        await tx.activityEvent.create({
          data: {
            organizationId,
            queueId: queue.id,
            type: 'TICKET_SERVED',
            payload: { ticketNumber: current.number, queueName: queue.name },
          },
        });
        this.realtimeService.publishTicketUpdated(organizationId, queue.id, current.id);
      }
      const next = await tx.ticket.findFirst({
        where: { queueId: queue.id, status: TicketStatus.WAITING },
        orderBy: { joinedAt: 'asc' },
      });
      if (!next) {
        return { message: 'No more guests are waiting' };
      }
      await tx.ticket.update({
        where: { id: next.id },
        data: { status: TicketStatus.CALLED, calledAt: new Date() },
      });
      await tx.activityEvent.create({
        data: {
          organizationId,
          queueId: queue.id,
          type: 'TICKET_CALLED',
          payload: { ticketNumber: next.number, queueName: queue.name },
        },
      });
      return { message: `Now calling ${next.number}` };
    });
    this.realtimeService.publishQueueUpdated(organizationId, queueId);
    return { message: result.message, queue: await this.findDetail(organizationId, queueId) };
  }

  async finishCurrent(
    organizationId: string,
    queueId: string,
    outcome: typeof TicketStatus.SERVED | typeof TicketStatus.SKIPPED,

  ): Promise<{ message: string; queue: QueueDetailDto }> {
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const queue = await this.lockQueue(tx, queueId);
      if (queue.organizationId !== organizationId) {
        throw new ForbiddenException('You do not have access to this queue');
      }
      const current = await tx.ticket.findFirst({
        where: { queueId: queue.id, status: TicketStatus.CALLED },
      });
      if (!current) {
        return { message: 'No guest is currently being called' };
      }
      await tx.ticket.update({
        where: { id: current.id },
        data: { status: outcome, finishedAt: new Date() },
      });
      await tx.activityEvent.create({
        data: {
          organizationId,
          queueId: queue.id,
          type: outcome === TicketStatus.SERVED ? 'TICKET_SERVED' : 'TICKET_SKIPPED',
          payload: { ticketNumber: current.number, queueName: queue.name },
        },
      });
      return {
        message: `${current.number} ${outcome === TicketStatus.SERVED ? 'completed' : 'skipped'}`,
        ticketId: current.id,
      };
    });
    if ('ticketId' in result) {
      this.realtimeService.publishTicketUpdated(organizationId, queueId, result.ticketId!);
    }
    this.realtimeService.publishQueueUpdated(organizationId, queueId);
    return { message: result.message, queue: await this.findDetail(organizationId, queueId) };
  }

  async setStatus(
    organizationId: string,
    queueId: string,
    status: typeof QueueStatus.ACTIVE | typeof QueueStatus.PAUSED,

  ): Promise<{ message: string; queue: QueueDetailDto }> {
    const queue = await this.getOrgQueue(organizationId, queueId);
    if (queue.status === status) {
      throw new ConflictException(`Queue is already ${status.toLowerCase()}`);
    }
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.queue.update({
        where: { id: queue.id },
        data: { status },
      });
      await tx.activityEvent.create({
        data: {
          organizationId,
          queueId: queue.id,
          type: status === QueueStatus.PAUSED ? 'QUEUE_PAUSED' : 'QUEUE_RESUMED',
          payload: { queueName: queue.name },
        },
      });
    });
    this.realtimeService.publishQueueUpdated(organizationId, queue.id);
    return {
      message: status === QueueStatus.PAUSED ? 'Queue paused' : 'Queue resumed',
      queue: await this.findDetail(organizationId, queue.id),
    };
  }

  async nextCode(tx: Prisma.TransactionClient, organizationId: string): Promise<string> {
    const queues = await tx.queue.findMany({
      where: { organizationId },
      select: { code: true },
    });
    const used = new Set(queues.map((q) => q.code));
    for (let i = 0; i < 26; i += 1) {
      const code = String.fromCharCode(65 + i);
      if (!used.has(code)) {
        return code;
      }
    }
    throw new BadRequestException('Maximum number of queues reached');
  }

  async getOrgQueue(organizationId: string, queueId: string): Promise<Queue> {
    const queue = await this.prisma.queue.findUnique({ where: { id: queueId } });
    if (!queue) {
      throw new NotFoundException('Queue not found');
    }
    if (queue.organizationId !== organizationId) {
      throw new ForbiddenException('You do not have access to this queue');
    }
    return queue;
  }

  async lockQueue(tx: Prisma.TransactionClient, queueId: string): Promise<QueueRow> {
    const rows = await tx.$queryRaw<QueueRow[]>(
      Prisma.sql`SELECT id, "organizationId", name, code, service, status, "avgMinutes", desks, "ticketSequence" FROM queues WHERE id = ${queueId} FOR UPDATE`,
    );
    if (rows.length === 0) {
      throw new NotFoundException('Queue not found');
    }
    return rows[0];
  }

  toQueueResponse(queue: Queue) {
    return toQueueResponse(queue);
  }

  toTicketResponse(ticket: Ticket) {
    return toTicketResponse(ticket);
  }

  estimateMinutes(waitingCount: number, avgMinutes: number, desks: number) {
    return estimateMinutes(waitingCount, avgMinutes, desks);
  }

  estimateRange(eta: number): { low: number; high: number } {
    return {
      low: Math.max(1, eta - ESTIMATE_RANGE_LOW_OFFSET),
      high: eta + ESTIMATE_RANGE_HIGH_OFFSET,
    };
  }
}

