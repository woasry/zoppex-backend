import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';

interface OblioTokenResponse {
  access_token: string;
  expires_in: string;
}

@Injectable()
export class InvoicingService {
  private readonly logger = new Logger(InvoicingService.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  async issueForStripePayment(
    stripeSubscriptionId: string,
    amountPaid: number,
    currency: string,
    stripeInvoiceNumber: string,
  ): Promise<void> {
    const oblio = this.configService.get('oblio', { infer: true });
    if (!oblio.clientId || !oblio.clientSecret || !oblio.cif) {
      this.logger.debug('Oblio not configured, skipping invoicing');
      return;
    }
    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
      include: { organization: true },
    });
    if (!subscription) {
      return;
    }
    const amount = amountPaid / 100;
    try {
      const token = await this.getAccessToken();
      const response = await fetch(
        `https://www.oblio.eu/api/invoice?cif=${encodeURIComponent(oblio.cif)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            seriesName: null,
            client: {
              name: subscription.organization.name,
              email: subscription.organization.contactEmail,
            },
            issuanceDate: new Date().toISOString().slice(0, 10),
            currency,
            products: [
              {
                name: 'ZOPPEX subscription',
                measuringUnit: 'month',
                quantity: 1,
                price: amount,
              },
            ],
          }),
        },
      );
      const body = (await response.json()) as {
        status: number;
        data?: { series?: string; number?: number };
        statusMessage?: string;
      };
      if (!response.ok || body.status >= 400) {
        throw new Error(body.statusMessage ?? `Oblio responded ${response.status}`);
      }
      await this.prisma.oblioInvoice.create({
        data: {
          organizationId: subscription.organizationId,
          seriesName: body.data?.series ?? '',
          number: body.data?.number ?? 0,
          status: 'ISSUED',
          amount,
          currency,
          oblioResponse: body as unknown as Record<string, unknown>,
        },
      });
      this.logger.log(
        `Oblio invoice issued for organization ${subscription.organizationId}`,
      );
    } catch (error) {
      this.logger.error(`Oblio invoicing failed: ${(error as Error).message}`);
      await this.prisma.oblioInvoice.create({
        data: {
          organizationId: subscription.organizationId,
          seriesName: '',
          number: 0,
          status: 'FAILED',
          amount,
          currency,
          error: (error as Error).message,
        },
      });
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }
    const oblio = this.configService.get('oblio', { infer: true });
    const response = await fetch('https://www.oblio.eu/api/authorize/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oblio.clientId,
        client_secret: oblio.clientSecret,
      }),
    });
    const body = (await response.json()) as OblioTokenResponse;
    if (!response.ok || !body.access_token) {
      throw new Error('Could not authenticate with Oblio');
    }
    this.token = body.access_token;
    this.tokenExpiresAt = Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000;
    return this.token;
  }
}
