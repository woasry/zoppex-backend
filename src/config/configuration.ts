import { EnvironmentVariables } from './env.validation';

export interface AppConfig {
  nodeEnv: string;
  port: number;

  appUrl: string;
  corsOrigins: string[];
  databaseUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  trialDays: number;
  maxMembersPerOrg: number;
  mail: {
    driver: 'console' | 'smtp';
    from: string;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  stripe: {
    secretKey: string;
    webhookSecret: string;
    priceMonthlyGbp: string;
    priceAnnualGbp: string;
    priceMonthlyUsd: string;
    priceAnnualUsd: string;
  };
  oblio: {
    clientId: string;
    clientSecret: string;
    cif: string;
  };
}

export default (): AppConfig => {
  const env = process.env as unknown as Record<string, string>;
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: Number(env.PORT ?? 4000),

    appUrl: env.APP_URL,
    corsOrigins: (env.CORS_ORIGIN ?? '').split(',').map((origin) => origin.trim()),
    databaseUrl: env.DATABASE_URL,
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    },
    trialDays: Number(env.TRIAL_DAYS ?? 14),
    maxMembersPerOrg: Number(env.MAX_MEMBERS_PER_ORG ?? 10),
    mail: {
      driver: (env.MAIL_DRIVER ?? 'console') as 'console' | 'smtp',
      from: env.MAIL_FROM,
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? 465),
      secure: String(env.SMTP_SECURE ?? 'true') === 'true',
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
      priceMonthlyGbp: env.STRIPE_PRICE_MONTHLY_GBP ?? '',
      priceAnnualGbp: env.STRIPE_PRICE_ANNUAL_GBP ?? '',
      priceMonthlyUsd: env.STRIPE_PRICE_MONTHLY_USD ?? '',
      priceAnnualUsd: env.STRIPE_PRICE_ANNUAL_USD ?? '',
    },
    oblio: {
      clientId: env.OBLIO_CLIENT_ID ?? '',
      clientSecret: env.OBLIO_CLIENT_SECRET ?? '',
      cif: env.OBLIO_CIF ?? '',
    },
  };
};

export type { EnvironmentVariables };
