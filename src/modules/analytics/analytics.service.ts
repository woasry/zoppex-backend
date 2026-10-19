import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export class OverviewStatsDto {
  visitorsToday: number;
  currentlyWaiting: number;
  servedToday: number;
  activeQueues: number;
  totalQueues: number;
}

export class AnalyticsKpisDto {
  totalCheckIns: number;
  avgWaitMinutes: number;
  guestsServed: number;
  guestsWaitingNow: number;
}

export class ArrivalsByDayDto {
  date: string;
  count: number;
}

export class QueuePerformanceDto {
  queueId: string;
  queueName: string;
  waiting: number;
  served: number;
  skipped: number;
  avgWaitMinutes: number;
}

export class AnalyticsResponseDto {
  kpis: AnalyticsKpisDto;
  arrivalsByDay: ArrivalsByDayDto[];
  perQueue: QueuePerformanceDto[];
  rangeDays: number;
}

export interface OverviewStats {
  visitorsToday: number;
  currentlyWaiting: number;
  servedToday: number;
  activeQueues: number;
  totalQueues: number;
}

export interface AnalyticsKpis {
  totalCheckIns: number;
  avgWaitMinutes: number;
  guestsServed: number;
  guestsWaitingNow: number;
}

export interface ArrivalsByDay {
  date: string;
  count: number;
}

export interface QueuePerformance {
  queueId: string;
  queueName: string;
  waiting: number;
  served: number;
  skipped: number;
  avgWaitMinutes: number;
}

export interface AnalyticsResponse {
  kpis: AnalyticsKpis;
  arrivalsByDay: ArrivalsByDay[];
  perQueue: QueuePerformance[];
  rangeDays: number;
}

interface DayCountRow {
  day: Date;
  count: bigint;
}

interface WaitRow {
  queueId: string;
  queueName: string;
  served: bigint;
  skipped: bigint;
  avgWait: bigint | null;
}

function startOfDay(date = new Date()): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverviewStats(organizationId: string): Promise<OverviewStats> {
    const today = startOfDay();
    const [visitorsToday, currentlyWaiting, servedToday, totalQueues, activeQueues] =
      await Promise.all([
        this.prisma.ticket.count({
          where: { queue: { organizationId }, joinedAt: { gte: today } },
        }),
        this.prisma.ticket.count({
          where: { queue: { organizationId }, status: 'WAITING' },
        }),
        this.prisma.ticket.count({
          where: {
            queue: { organizationId },
            status: 'SERVED',
            finishedAt: { gte: today },
          },
        }),
        this.prisma.queue.count({ where: { organizationId } }),
        this.prisma.queue.count({ where: { organizationId, status: 'ACTIVE' } }),
      ]);
    return {
      visitorsToday,
      currentlyWaiting,
      servedToday,
      activeQueues,
      totalQueues,
    };
  }

  async getAnalytics(organizationId: string, rangeDays: number): Promise<AnalyticsResponse> {
    const clampedDays = Math.min(Math.max(rangeDays, 7), 30);
    const rangeStart = new Date(startOfDay().getTime() - (clampedDays - 1) * 24 * 60 * 60 * 1000);

    const [totalCheckIns, guestsServed, guestsWaitingNow, dayRows, waitRows] = await Promise.all([
      this.prisma.ticket.count({
        where: { queue: { organizationId }, joinedAt: { gte: rangeStart } },
      }),
      this.prisma.ticket.count({
        where: {
          queue: { organizationId },
          status: 'SERVED',
          finishedAt: { gte: rangeStart },
        },
      }),
      this.prisma.ticket.count({
        where: { queue: { organizationId }, status: 'WAITING' },
      }),
      this.prisma.$queryRaw<DayCountRow[]>(
        Prisma.sql`
          SELECT date_trunc('day', t."joinedAt") AS day, COUNT(*) AS count
          FROM tickets t
          JOIN queues q ON q.id = t."queueId"
          WHERE q."organizationId" = ${organizationId}
            AND t."joinedAt" >= ${rangeStart}
          GROUP BY 1
          ORDER BY 1 ASC
        `,
      ),
      this.prisma.$queryRaw<WaitRow[]>(
        Prisma.sql`
          SELECT
            q.id AS "queueId",
            q.name AS "queueName",
            COUNT(*) FILTER (WHERE t.status = 'SERVED' AND t."finishedAt" >= ${rangeStart}) AS served,
            COUNT(*) FILTER (WHERE t.status = 'SKIPPED' AND t."finishedAt" >= ${rangeStart}) AS skipped,
            AVG(EXTRACT(EPOCH FROM (t."calledAt" - t."joinedAt")) / 60) FILTER (WHERE t."calledAt" IS NOT NULL AND t."joinedAt" >= ${rangeStart}) AS "avgWait"
          FROM queues q
          LEFT JOIN tickets t ON t."queueId" = q.id
          WHERE q."organizationId" = ${organizationId}
          GROUP BY q.id, q.name
          ORDER BY q."createdAt" ASC
        `,
      ),
    ]);

    const waitingByQueue = await this.prisma.ticket.groupBy({
      by: ['queueId'],
      where: { queue: { organizationId }, status: 'WAITING' },
      _count: { _all: true },
    });
    const waitingMap = new Map(waitingByQueue.map((row) => [row.queueId, row._count._all]));

    const arrivalsMap = new Map(dayRows.map((row) => [row.day.toISOString().slice(0, 10), Number(row.count)]));
    const arrivalsByDay: ArrivalsByDayDto[] = [];
    for (let i = 0; i < clampedDays; i += 1) {
      const date = new Date(rangeStart.getTime() + i * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      arrivalsByDay.push({ date, count: arrivalsMap.get(date) ?? 0 });
    }

    const avgWaitOverall =
      waitRows.length > 0
        ? waitRows.reduce((sum, row) => sum + Number(row.avgWait ?? 0) * Number(row.served), 0) /
          Math.max(1, waitRows.reduce((sum, row) => sum + Number(row.served), 0))
        : 0;

    return {
      kpis: {
        totalCheckIns,
        avgWaitMinutes: Math.round(avgWaitOverall * 10) / 10,
        guestsServed,
        guestsWaitingNow,
      },
      arrivalsByDay,
      perQueue: waitRows.map((row) => ({
        queueId: row.queueId,
        queueName: row.queueName,
        waiting: waitingMap.get(row.queueId) ?? 0,
        served: Number(row.served),
        skipped: Number(row.skipped),
        avgWaitMinutes: row.avgWait === null ? 0 : Math.round(Number(row.avgWait) * 10) / 10,
      })),
      rangeDays: clampedDays,
    };
  }
}
