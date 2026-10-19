import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PublicController } from './public.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [RealtimeModule, QueuesModule],
  controllers: [PublicController],
  providers: [TicketsService],
})
export class TicketsModule {}
