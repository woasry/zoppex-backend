import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { QueuesModule } from '../queues/queues.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PublicController } from './public.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 120,
      },
    ]),
    RealtimeModule,
    QueuesModule,
  ],
  controllers: [PublicController],
  providers: [TicketsService],
})
export class TicketsModule {}
