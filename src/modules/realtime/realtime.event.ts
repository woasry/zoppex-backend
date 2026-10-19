export enum RealtimeEventType {
  QueueUpdated = 'queue.updated',
  TicketUpdated = 'ticket.updated',
}

export interface RealtimeEvent {
  type: RealtimeEventType;
  queueId: string;
  ticketId?: string;
  at: string;
}

export interface RealtimeMessage {
  data: RealtimeEvent | 'heartbeat';
}
