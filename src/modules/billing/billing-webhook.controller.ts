import { BadRequestException, Controller, Headers, HttpCode, Logger, Post, Req, RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { BillingService } from './billing.service';

interface InvoiceWithSubscription extends Stripe.Invoice {
  subscription?: string | { id: string } | null;
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string } | null;
    };
  } | null;
}

function extractSubscriptionId(invoice: InvoiceWithSubscription): string | null {
  const direct = invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
  if (!direct) {
    return null;
  }
  return typeof direct === 'string' ? direct : direct.id;
}

@Controller('billing')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly invoicingService: InvoicingService,
  ) {
    this.stripe = new Stripe(this.configService.get('stripe.secretKey', { infer: true }), {
      apiVersion: '2024-06-20',
    });
  }

  @Post('webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async handle(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    const secret = this.configService.get('stripe.webhookSecret', { infer: true });
    if (!secret || !req.rawBody || !signature) {
      throw new BadRequestException('Webhook not configured');
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(req.rawBody, signature, secret);
    } catch (error) {
      throw new BadRequestException(`Invalid signature: ${(error as Error).message}`);
    }
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
    });
    if (existing) {
      return { received: true };
    }
    await this.prisma.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: event.id,
        type: event.type,
        payload: event.data.object as unknown as Prisma.InputJsonValue,
      },
    });
    try {
      await this.process(event);
      await this.prisma.webhookEvent.update({
        where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(`Webhook ${event.type} processing failed: ${(error as Error).message}`);
    }
    return { received: true };
  }

  private async process(event: Stripe.Event): Promise<void> {
    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const record = await this.prisma.subscription.findUnique({
        where: { stripeSubscriptionId: subscription.id },
      });
      if (record) {
        await this.billingService.applyStripeSubscription(record.organizationId, subscription);
      }
      return;
    }
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as InvoiceWithSubscription;
      const subscriptionId = extractSubscriptionId(invoice);
      if (subscriptionId && invoice.amount_paid > 0) {
        await this.billingService.recordPayment(
          subscriptionId,
          invoice.amount_paid,
          invoice.currency,
        );
        await this.invoicingService.issueForStripePayment(
          subscriptionId,
          invoice.amount_paid,
          invoice.currency,
          invoice.number ?? '',
        );
      }
      return;
    }
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as InvoiceWithSubscription;
      const subscriptionId = extractSubscriptionId(invoice);
      if (subscriptionId) {
        await this.billingService.markPastDue(subscriptionId);
      }
    }
  }
}
