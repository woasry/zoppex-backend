import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QueueResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty({ example: 'Main Reception' })
  name: string;

  @ApiProperty({ example: 'A' })
  code: string;

  @ApiProperty({ example: 'Walk-in assistance' })
  service: string;

  @ApiProperty({ enum: ['ACTIVE', 'PAUSED'] })
  status: string;

  @ApiProperty({ example: 5 })
  avgMinutes: number;

  @ApiProperty({ example: 2 })
  desks: number;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class QueueWithStatsDto extends QueueResponseDto {
  @ApiProperty({ example: 4 })
  waitingCount: number;

  @ApiProperty({ example: 10 })
  estimatedWaitMinutes: number;

  @ApiProperty({ example: 'A024', nullable: true })
  calledTicketNumber: string | null;

  @ApiProperty({ example: 23 })
  servedCount: number;
}

export class TicketResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  queueId: string;

  @ApiProperty({ example: 'A024' })
  number: string;

  @ApiProperty({ example: 'Olivia', nullable: true })
  displayName: string | null;

  @ApiProperty({ enum: ['WAITING', 'CALLED', 'SERVED', 'SKIPPED', 'CANCELLED'] })
  status: string;

  @ApiProperty()
  joinedAt: string;

  @ApiProperty({ nullable: true })
  calledAt: string | null;

  @ApiProperty({ nullable: true })
  finishedAt: string | null;
}

export class QueueDetailDto extends QueueWithStatsDto {
  @ApiProperty({ type: [TicketResponseDto] })
  tickets: TicketResponseDto[];
}

export class QueueActionResultDto {
  @ApiProperty({ example: 'Now calling A024' })
  message: string;

  @ApiProperty({ type: QueueDetailDto })
  queue: QueueDetailDto;
}

export class PublicQueueInfoDto {
  @ApiProperty()
  queueId: string;

  @ApiProperty({ example: 'Main Reception' })
  queueName: string;

  @ApiProperty({ example: 'Atelier Studio' })
  organizationName: string;

  @ApiProperty({ example: 'London, United Kingdom', nullable: true })
  location: string | null;

  @ApiProperty({ example: 'Walk-in assistance' })
  service: string;

  @ApiProperty({ enum: ['ACTIVE', 'PAUSED'] })
  status: string;

  @ApiProperty({ example: 4 })
  waitingCount: number;

  @ApiProperty({ example: 10 })
  estimatedWaitMinutes: number;
}

export class JoinTicketResponseDto {
  @ApiProperty()
  ticketId: string;

  @ApiProperty({ example: 'A030' })
  number: string;
}

export class TicketPositionDto {
  @ApiProperty()
  ticketId: string;

  @ApiProperty({ example: 'A026' })
  number: string;

  @ApiProperty({ enum: ['WAITING', 'CALLED', 'SERVED', 'SKIPPED', 'CANCELLED'] })
  status: string;

  @ApiProperty({ example: 3 })
  peopleAhead: number;

  @ApiProperty({ example: 8 })
  estimatedWaitMinutes: number;

  @ApiProperty({ example: { low: 6, high: 11 } })
  estimateRangeMinutes: { low: number; high: number };

  @ApiProperty({ example: 'Main Reception' })
  queueName: string;

  @ApiProperty({ example: 'Atelier Studio' })
  organizationName: string;

  @ApiProperty({ enum: ['ACTIVE', 'PAUSED'] })
  queueStatus: string;
}
