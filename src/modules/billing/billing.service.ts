import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subscription, BillingCurrency, BillingInterval, MemberRole, SubscriptionStatus } from '@prisma/client';



import Stripe from 'stripe';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { InvoicingService } from '../invoicing/invoicing.service';

import {
  renderPaymentReceivedEmail,
  renderSubscriptionConfirmedEmail,
} from '../notifications/email-templates';

export interface SubscribeRequest {
  interval: BillingInterval;
  currency: BillingCurrency;
}

export class SubscribeRequestDto {
  interval: BillingInterval;
  currency: BillingCurrency;
}

export class SubscribeResponseDto {
  subscriptionId: string;
  clientSecret: string;
}

export class BillingPlanDto {
  interval: string;
  currency: string;
  label: string;
}

export class BillingStatusDto {
  status: string;
  interval: string | null;
  currency: string | null;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  amountLabel: string | null;
  plans: BillingPlanDto[];
}

const STATUS_MAP: Record<string, Subscription['status']> = {
  trialing: SubscriptionStatus.TRIALING,
  active: SubscriptionStatus.ACTIVE,

  past_due: SubscriptionStatus.PAST_DUE,
  canceled: SubscriptionStatus.CANCELED,
  unpaid: SubscriptionStatus.CANCELED,
  incomplete_expired: SubscriptionStatus.CANCELED,
};

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount / 100);
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly emailService: EmailService,
    private readonly invoicingService: InvoicingService,
  ) {
    this.stripe = new Stripe(this.configService.get('stripe.secretKey', { infer: true }));
  }

  async handleStripeEvent(event: Stripe.Event): Promise<void> {
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
        await this.applyStripeSubscription(record.organizationId, subscription);
      }
      return;
    }
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = this.extractSubscriptionId(invoice);
      if (subscriptionId && invoice.amount_paid > 0) {
        await this.recordPayment(subscriptionId, invoice.amount_paid, invoice.currency);
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
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = this.extractSubscriptionId(invoice);
      if (subscriptionId) {
        await this.markPastDue(subscriptionId);
      }
    }
  }

  private extractSubscriptionId(invoice: Stripe.Invoice): string | null {
    const value = invoice.subscription;
    if (!value) {
      return null;
    }
    return typeof value === 'string' ? value : value.id;
  }


  async getStatus(organizationId: string): Promise<BillingStatusDto> {
    const subscription = await this.getSubscription(organizationId);
    if (subscription.stripeSubscriptionId) {
      await this.syncFromStripe(subscription);
    }
    const fresh = await this.getSubscription(organizationId);
    return {
      status: fresh.status,
      interval: fresh.interval,
      currency: fresh.currency,
      trialEndsAt: fresh.trialEndsAt.toISOString(),
      currentPeriodEnd: fresh.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: fresh.canceledAt !== null,
      amountLabel: this.priceLabel(fresh.interval, fresh.currency),
      plans: this.buildPlans(),
    };
  }

  private buildPlans(): BillingPlanDto[] {
    const pricing = this.configService.get('pricing', { infer: true });
    return [
      { interval: BillingInterval.MONTHLY, currency: BillingCurrency.GBP, label: `£${pricing.monthlyGbp} per month` },
      { interval: BillingInterval.ANNUAL, currency: BillingCurrency.GBP, label: `£${pricing.annualGbp} per year` },
      { interval: BillingInterval.MONTHLY, currency: BillingCurrency.USD, label: `$${pricing.monthlyUsd} per month` },
      { interval: BillingInterval.ANNUAL, currency: BillingCurrency.USD, label: `$${pricing.annualUsd} per year` },
    ];
  }

  async subscribe(
    organizationId: string,
    ownerEmail: string,
    organizationName: string,
    request: SubscribeRequest,
  ): Promise<SubscribeResponseDto> {
    const subscription = await this.getSubscription(organizationId);
    if (subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.PAST_DUE) {

      throw new BadRequestException('This workspace already has an active subscription');
    }
    const priceId = this.priceId(request.interval, request.currency);
    const customerId = await this.ensureCustomer(
      subscription,
      ownerEmail,
      organizationName,
    );
    const stripeSubscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    });
    const latestInvoice = stripeSubscription.latest_invoice as
      | (Stripe.Invoice & { payment_intent: string | Stripe.PaymentIntent | null })
      | undefined;
    const paymentIntent = latestInvoice?.payment_intent;
    const clientSecret =
      typeof paymentIntent === 'string'
        ? (await this.stripe.paymentIntents.retrieve(paymentIntent)).client_secret
        : paymentIntent?.client_secret ?? null;
    if (!clientSecret) {
      throw new BadRequestException('Could not initialize the payment. Try again.');
    }
    await this.prisma.subscription.update({
      where: { organizationId },
      data: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSubscription.id,
        interval: request.interval,
        currency: request.currency as BillingCurrency,
      },
    });
    return {
      subscriptionId: stripeSubscription.id,
      clientSecret,
    };
  }

  async setCancelAtPeriodEnd(organizationId: string, cancel: boolean): Promise<void> {
    const subscription = await this.getSubscription(organizationId);
    if (!subscription.stripeSubscriptionId) {
      throw new BadRequestException('No active subscription to manage');
    }
    await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: cancel,
    });
    await this.prisma.subscription.update({
      where: { organizationId },
      data: { canceledAt: cancel ? new Date() : null },
    });
  }

  async syncFromStripe(subscription: Subscription): Promise<void> {
    if (!subscription.stripeSubscriptionId) {
      return;
    }
    const stripeSubscription = await this.stripe.subscriptions
      .retrieve(subscription.stripeSubscriptionId)
      .catch(() => null);
    if (!stripeSubscription) {
      return;
    }
    await this.applyStripeSubscription(subscription.organizationId, stripeSubscription);
  }

  async applyStripeSubscription(
    organizationId: string,
    stripeSubscription: Stripe.Subscription,
  ): Promise<void> {
    const current = await this.getSubscription(organizationId);
    const mappedStatus = STATUS_MAP[stripeSubscription.status] ?? SubscriptionStatus.CANCELED;
    const item = stripeSubscription.items.data[0];
    const price = item?.price;
    const interval = price?.recurring?.interval === 'year' ? BillingInterval.ANNUAL : BillingInterval.MONTHLY;
    const currency = (price?.currency ?? 'gbp').toUpperCase() as BillingCurrency;
    const amount = price?.unit_amount ?? 0;
    const becameActive =
      mappedStatus === SubscriptionStatus.ACTIVE && current.status !== SubscriptionStatus.ACTIVE && !current.canceledAt;

    await this.prisma.subscription.update({
      where: { organizationId },
      data: {
        status: mappedStatus,
        interval,
        currency,
        currentPeriodEnd: stripeSubscription.current_period_end
          ? new Date(stripeSubscription.current_period_end * 1000)
          : null,
        canceledAt:
          mappedStatus === SubscriptionStatus.CANCELED
            ? new Date()
            : stripeSubscription.cancel_at_period_end
              ? new Date()
              : null,
      },
    });
    if (becameActive) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
      const ownerMembership = await this.prisma.membership.findFirst({
        where: { organizationId, role: MemberRole.OWNER },
        include: { user: true },
      });
      if (organization && ownerMembership) {
        await this.emailService.send({
          to: ownerMembership.user.email,
          template: renderSubscriptionConfirmedEmail(
            organization.name,
            formatAmount(amount, currency.toLowerCase()),
            interval === BillingInterval.ANNUAL ? 'year' : 'month',
            this.configService.get('appUrl', { infer: true }),
          ),
        });
      }
    }
  }

  async recordPayment(
    stripeSubscriptionId: string,
    amount: number,
    currency: string,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
    });
    if (!subscription) {
      return;
    }
    const organization = await this.prisma.organization.findUnique({
      where: { id: subscription.organizationId },
    });
    const ownerMembership = await this.prisma.membership.findFirst({
      where: { organizationId: subscription.organizationId, role: MemberRole.OWNER },
      include: { user: true },
    });
    if (organization && ownerMembership) {
      await this.emailService.send({
        to: ownerMembership.user.email,
        template: renderPaymentReceivedEmail(
          organization.name,
          formatAmount(amount, currency),
          this.configService.get('appUrl', { infer: true }),
        ),
      });
    }
  }

  async markPastDue(stripeSubscriptionId: string): Promise<void> {
    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId, status: { not: SubscriptionStatus.CANCELED } },
      data: { status: SubscriptionStatus.PAST_DUE },
    });
  }

  private async ensureCustomer(
    subscription: Subscription,
    ownerEmail: string,
    organizationName: string,
  ): Promise<string> {
    if (subscription.stripeCustomerId) {
      return subscription.stripeCustomerId;
    }
    const customer = await this.stripe.customers.create({
      email: ownerEmail,
      name: organizationName,
      metadata: { organizationId: subscription.organizationId },
    });
    return customer.id;
  }

  private async getSubscription(organizationId: string): Promise<Subscription> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });
    if (!subscription) {
      throw new NotFoundException('No subscription found for this workspace');
    }
    return subscription;
  }

  private priceId(interval: string, currency: string): string {
    const stripe = this.configService.get('stripe', { infer: true });
    const key = `${interval}_${currency}`;
    const map: Record<string, string> = {
      MONTHLY_GBP: stripe.priceMonthlyGbp,
      ANNUAL_GBP: stripe.priceAnnualGbp,
      MONTHLY_USD: stripe.priceMonthlyUsd,
      ANNUAL_USD: stripe.priceAnnualUsd,
    };
    const priceId = map[key];
    if (!priceId) {
      throw new BadRequestException('This plan option is not available');
    }
    return priceId;
  }

  private priceLabel(interval: string | null, currency: string | null): string | null {
    if (!interval || !currency) {
      return null;
    }
    const pricing = this.configService.get('pricing', { infer: true });
    const amount =
      interval === BillingInterval.ANNUAL
        ? currency === BillingCurrency.GBP
          ? pricing.annualGbp
          : pricing.annualUsd
        : currency === BillingCurrency.GBP
          ? pricing.monthlyGbp
          : pricing.monthlyUsd;
    return `${formatAmount(amount * 100, currency.toLowerCase())} / ${
      interval === BillingInterval.ANNUAL ? 'year' : 'month'
    }`;
  }
}
