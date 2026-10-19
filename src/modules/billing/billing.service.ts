import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subscription } from '@prisma/client';
import Stripe from 'stripe';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import {
  renderPaymentReceivedEmail,
  renderSubscriptionConfirmedEmail,
} from '../notifications/email-templates';

export interface SubscribeRequest {
  interval: 'MONTHLY' | 'ANNUAL';
  currency: 'GBP' | 'USD';
}

export class SubscribeRequestDto {
  interval: 'MONTHLY' | 'ANNUAL';
  currency: 'GBP' | 'USD';
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
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  canceled: 'CANCELED',
  unpaid: 'CANCELED',
  incomplete_expired: 'CANCELED',
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
  ) {
    this.stripe = new Stripe(this.configService.get('stripe.secretKey', { infer: true }), {
      apiVersion: '2024-06-20',
    });
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
      { interval: 'MONTHLY', currency: 'GBP', label: `£${pricing.monthlyGbp} per month` },
      { interval: 'ANNUAL', currency: 'GBP', label: `£${pricing.annualGbp} per year` },
      { interval: 'MONTHLY', currency: 'USD', label: `$${pricing.monthlyUsd} per month` },
      { interval: 'ANNUAL', currency: 'USD', label: `$${pricing.annualUsd} per year` },
    ];
  }

  async subscribe(
    organizationId: string,
    ownerEmail: string,
    organizationName: string,
    request: SubscribeRequest,
  ): Promise<SubscribeResponseDto> {
    const subscription = await this.getSubscription(organizationId);
    if (subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE') {
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
        currency: request.currency as 'GBP' | 'USD',
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
    const mappedStatus = STATUS_MAP[stripeSubscription.status] ?? 'CANCELED';
    const item = stripeSubscription.items.data[0];
    const price = item?.price;
    const interval = price?.recurring?.interval === 'year' ? 'ANNUAL' : 'MONTHLY';
    const currency = (price?.currency ?? 'gbp').toUpperCase() as 'GBP' | 'USD';
    const amount = price?.unit_amount ?? 0;
    const becameActive =
      mappedStatus === 'ACTIVE' && current.status !== 'ACTIVE' && !current.canceledAt;
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
          mappedStatus === 'CANCELED'
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
        where: { organizationId, role: 'OWNER' },
        include: { user: true },
      });
      if (organization && ownerMembership) {
        await this.emailService.send({
          to: ownerMembership.user.email,
          template: renderSubscriptionConfirmedEmail(
            organization.name,
            formatAmount(amount, currency.toLowerCase()),
            interval === 'ANNUAL' ? 'year' : 'month',
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
      where: { organizationId: subscription.organizationId, role: 'OWNER' },
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
      where: { stripeSubscriptionId, status: { not: 'CANCELED' } },
      data: { status: 'PAST_DUE' },
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
      interval === 'ANNUAL'
        ? currency === 'GBP'
          ? pricing.annualGbp
          : pricing.annualUsd
        : currency === 'GBP'
          ? pricing.monthlyGbp
          : pricing.monthlyUsd;
    return `${formatAmount(amount * 100, currency.toLowerCase())} / ${
      interval === 'ANNUAL' ? 'year' : 'month'
    }`;
  }
}
