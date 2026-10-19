import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transporter, createTransport } from 'nodemailer';
import { AppConfig } from '../../config/configuration';
import { EmailTemplate } from './email-templates';

export interface EmailMessage {
  to: string;
  template: EmailTemplate;
}

@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async onModuleInit(): Promise<void> {
    const mailConfig = this.configService.get('mail', { infer: true });
    if (mailConfig.driver !== 'smtp') {
      this.logger.log('Email driver: console (emails are logged, not sent)');
      return;
    }
    this.transporter = createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.secure,
      auth: { user: mailConfig.user, pass: mailConfig.pass },
      pool: true,
      maxConnections: 3,
    });
    try {
      await this.transporter.verify();
      this.logger.log(`SMTP connection verified: ${mailConfig.host}:${mailConfig.port}`);
    } catch (error) {
      this.logger.error(`SMTP connection failed: ${(error as Error).message}`);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.transporter?.close();
  }

  async send(message: EmailMessage): Promise<void> {
    const mailConfig = this.configService.get('mail', { infer: true });
    if (mailConfig.driver !== 'smtp' || !this.transporter) {
      this.logEmail(message);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: mailConfig.from,
        to: message.to,
        subject: message.template.subject,
        html: message.template.html,
        text: message.template.text,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email "${message.template.subject}" to ${message.to}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private logEmail(message: EmailMessage): void {
    this.logger.log(
      [
        '',
        '────────────── EMAIL (console driver) ──────────────',
        `To:      ${message.to}`,
        `Subject: ${message.template.subject}`,
        `Link:    ${this.extractLink(message.template.html)}`,
        '────────────────────────────────────────────────────',
      ].join('\n'),
    );
  }

  private extractLink(html: string): string {
    const match = /href="(https?:\/\/[^"]+)"/.exec(html);
    return match?.[1] ?? 'n/a';
  }
}
