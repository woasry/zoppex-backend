import { BadRequestException, Controller, Headers, HttpCode, Logger, Post, Req, RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from './billing.service';

@Controller('billing')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {
    this.stripe = new Stripe(this.configService.get('stripe.secretKey', { infer: true }));
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
      await this.billingService.handleStripeEvent(event);
      await this.prisma.webhookEvent.update({
        where: { provider_eventId: { provider: 'stripe', eventId: event.id } },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(`Webhook ${event.type} processing failed: ${(error as Error).message}`);
    }
    return { received: true };
  }
}

