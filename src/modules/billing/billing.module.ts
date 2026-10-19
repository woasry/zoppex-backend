import { Module } from '@nestjs/common';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingWebhookController } from './billing-webhook.controller';
import { TrialCronService } from './trial.cron';

@Module({
  imports: [InvoicingModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService, TrialCronService],
  exports: [BillingService],
})
export class BillingModule {}
