import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { renderTrialEndingEmail } from '../notifications/email-templates';

@Injectable()
export class TrialCronService {
  private readonly logger = new Logger(TrialCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async expireTrials(): Promise<void> {
    const result = await this.prisma.subscription.updateMany({
      where: {
        status: 'TRIALING',
        trialEndsAt: { lt: new Date() },
      },
      data: { status: 'TRIAL_EXPIRED' },
    });
    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} trials`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async sendTrialReminders(): Promise<void> {
    const appUrl = this.configService.get('appUrl', { infer: true });
    const reminderDays = [4, 1];
    for (const days of reminderDays) {
      const targetDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const start = new Date(targetDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const expiring = await this.prisma.subscription.findMany({
        where: {
          status: 'TRIALING',
          trialEndsAt: { gte: start, lt: end },
        },
        include: {
          organization: {
            include: { memberships: { where: { role: 'OWNER' }, include: { user: true } } },
          },
        },
      });
      for (const subscription of expiring) {
        const owner = subscription.organization.memberships[0]?.user;
        if (!owner) {
          continue;
        }
        await this.emailService.send({
          to: owner.email,
          template: renderTrialEndingEmail(
            subscription.organization.name,
            days,
            subscription.trialEndsAt.toISOString().slice(0, 10),
            appUrl,
          ),
        });
      }
      if (expiring.length > 0) {
        this.logger.log(`Sent ${expiring.length} trial reminders (${days} day(s) left)`);
      }
    }
  }
}
