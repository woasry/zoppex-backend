import { Injectable } from '@nestjs/common';
import { ActivityEvent } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export class ActivityEventResponseDto {
  id: string;
  organizationId: string;
  queueId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityEventResponse {
  id: string;
  organizationId: string;
  queueId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

function toResponse(event: ActivityEvent): ActivityEventResponse {
  return {
    id: event.id,
    organizationId: event.organizationId,
    queueId: event.queueId,
    type: event.type,
    payload: event.payload as Record<string, unknown>,
    createdAt: event.createdAt.toISOString(),
  };
}

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, limit: number): Promise<ActivityEventResponse[]> {
    const events = await this.prisma.activityEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return events.map(toResponse);
  }

  toResponse(event: ActivityEvent): ActivityEventResponse {
    return toResponse(event);
  }
}
