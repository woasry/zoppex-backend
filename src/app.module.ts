import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { HealthController } from './health/health.controller';
import { JwtGlobalModule } from './common/jwt-global.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmailModule } from './modules/notifications/email.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { QueuesModule } from './modules/queues/queues.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
      load: [configuration],
      validate,
    }),
    PrismaModule,
    JwtGlobalModule,
    EmailModule,
    OrganizationsModule,
    AuthModule,
    RealtimeModule,
    QueuesModule,
    TicketsModule,
    ActivityModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
