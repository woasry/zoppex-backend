import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum MailDriver {
  Console = 'console',
  Smtp = 'smtp',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  @IsOptional()
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @IsInt()
  @Min(1)
  @IsOptional()
  PORT: number = 4000;

  @IsString()
  APP_URL: string;

  @IsString()
  CORS_ORIGIN: string;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN = '30d';

  @IsInt()
  @Min(1)
  @IsOptional()
  TRIAL_DAYS: number = 14;

  @IsInt()
  @Min(1)
  @IsOptional()
  MAX_MEMBERS_PER_ORG: number = 10;

  @IsInt()
  @Min(1)
  @IsOptional()
  MAX_QUEUES_PER_ORG: number = 20;

  @IsEnum(MailDriver)
  @IsOptional()
  MAIL_DRIVER = MailDriver.Console;

  @IsString()
  MAIL_FROM: string;

  @ValidateIf((o) => o.MAIL_DRIVER === MailDriver.Smtp)
  @IsString()
  SMTP_HOST: string;

  @ValidateIf((o) => o.MAIL_DRIVER === MailDriver.Smtp)
  @IsInt()
  @Min(1)
  SMTP_PORT: number;

  @ValidateIf((o) => o.MAIL_DRIVER === MailDriver.Smtp)
  @IsBoolean()
  SMTP_SECURE: boolean;

  @ValidateIf((o) => o.MAIL_DRIVER === MailDriver.Smtp)
  @IsString()
  SMTP_USER: string;

  @ValidateIf((o) => o.MAIL_DRIVER === MailDriver.Smtp)
  @IsString()
  SMTP_PASS: string;

  @IsString()
  @IsOptional()
  STRIPE_SECRET_KEY: string;

  @IsString()
  @IsOptional()
  STRIPE_WEBHOOK_SECRET: string;

  @IsString()
  @IsOptional()
  STRIPE_PRICE_MONTHLY_GBP: string;

  @IsString()
  @IsOptional()
  STRIPE_PRICE_ANNUAL_GBP: string;

  @IsString()
  @IsOptional()
  STRIPE_PRICE_MONTHLY_USD: string;

  @IsString()
  @IsOptional()
  STRIPE_PRICE_ANNUAL_USD: string;

  @IsString()
  @IsOptional()
  OBLIO_CLIENT_ID: string;

  @IsString()
  @IsOptional()
  OBLIO_CLIENT_SECRET: string;

  @IsString()
  @IsOptional()
  OBLIO_CIF: string;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Environment validation failed: ${errors.toString()}`);
  }
  return validatedConfig;
}
