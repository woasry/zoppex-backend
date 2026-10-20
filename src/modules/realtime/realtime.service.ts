import { Injectable, Logger } from '@nestjs/common';
import { MessageEvent } from '@nestjs/common';
import { Subject, interval, merge } from 'rxjs';
import { finalize, map } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeEvent, RealtimeEventType } from './realtime.event';

type StreamMap = Map<string, Set<Subject<MessageEvent>>>;

const HEARTBEAT_INTERVAL_MS = 25000;

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly orgStreams: StreamMap = new Map();
  private readonly queueStreams: StreamMap = new Map();
  private readonly ticketStreams: StreamMap = new Map();

  constructor(private readonly prisma: PrismaService) {}

  async hasOrganizationAccess(userId: string, organizationId: string): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    return membership !== null;
  }


  streamOrganization(organizationId: string) {
    return this.createStream(this.orgStreams, organizationId);
  }

  streamQueue(queueId: string) {
    return this.createStream(this.queueStreams, queueId);
  }

  streamTicket(ticketId: string) {
    return this.createStream(this.ticketStreams, ticketId);
  }

  publishQueueUpdated(organizationId: string, queueId: string): void {
    const event: RealtimeEvent = {
      type: RealtimeEventType.QueueUpdated,
      queueId,
      at: new Date().toISOString(),
    };
    this.emit(this.orgStreams, organizationId, event);
    this.emit(this.queueStreams, queueId, event);
  }

  publishTicketUpdated(
    organizationId: string,
    queueId: string,
    ticketId: string,
  ): void {
    const event: RealtimeEvent = {
      type: RealtimeEventType.TicketUpdated,
      queueId,
      ticketId,
      at: new Date().toISOString(),
    };
    this.emit(this.orgStreams, organizationId, event);
    this.emit(this.queueStreams, queueId, event);
    this.emit(this.ticketStreams, ticketId, event);
  }

  private createStream(streams: StreamMap, key: string) {
    const subject = new Subject<MessageEvent>();
    if (!streams.has(key)) {
      streams.set(key, new Set());
    }
    const set = streams.get(key);
    if (set) {
      set.add(subject);
    }
    const cleanup = () => {
      const set = streams.get(key);
      set?.delete(subject);
      if (set && set.size === 0) {
        streams.delete(key);
      }
    };
    return merge(
      subject.asObservable().pipe(finalize(cleanup)),
      interval(HEARTBEAT_INTERVAL_MS).pipe(
        map((): MessageEvent => ({ data: 'heartbeat' })),
      ),
    );
  }

  private emit(streams: StreamMap, key: string, event: RealtimeEvent): void {
    const set = streams.get(key);
    if (!set) {
      return;
    }
    for (const subject of set) {
      subject.next({ data: event });
    }
  }
}
