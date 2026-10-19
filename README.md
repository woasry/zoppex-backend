# ZOPPEX Backend

NestJS API for the ZOPPEX queue management platform.

## Stack

- NestJS 11, TypeScript strict
- Prisma ORM + PostgreSQL 14
- class-validator / class-transformer DTO validation
- Stripe SDK 17.7.0 (pinned, API 2025-02-24.acacia)
- Nodemailer (SMTP via CPanel, console driver for local dev)
- Swagger (OpenAPI) at `/api/docs`

## Getting started

```bash
npm install
cp .env.example .env
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

The API runs on `http://localhost:4000`. Swagger UI is available at `http://localhost:4000/api/docs`.

Seeded demo account: `owner@zoppex.dev` / `Password123!`

## Project structure

```
src/
├── main.ts
├── app.module.ts
├── config/            env validation + typed configuration
├── common/
│   ├── filters/       global error envelope
│   ├── guards/        JWT, org member, subscription guards
│   ├── decorators/    current user / organization / roles
│   └── jwt-global.module.ts
├── prisma/            PrismaModule + PrismaService
└── modules/
    ├── auth/          register, login, refresh rotation, email verification, password reset, invitation accept
    ├── organizations/ workspace identity, members, invitations
    ├── queues/        CRUD + call-next / serve / skip / pause (transactional, row locks)
    ├── tickets/       public guest endpoints (join, live position)
    ├── activity/      activity feed
    ├── analytics/     overview KPIs + SQL aggregations (7-30 days)
    ├── realtime/      SSE streams (org, public queue, public ticket)
    ├── billing/       Stripe Payment Element subscribe, webhooks (idempotent), trial cron, cancel/resume
    ├── invoicing/     Oblio invoicing on invoice.paid (token cache, graceful skip)
    └── notifications/ Nodemailer + branded email templates
```

## Security model

- JWT access token (15 min) + refresh token rotation (httpOnly cookie, SHA-256 hashed, reuse detection).
- `OrgMemberGuard` validates membership via the `X-Organization-Id` header; `@Roles()` restricts by role.
- `SubscriptionGuard` blocks queue mutations (402) when the trial/subscription has ended; reads and guest pages stay available.
- Global throttler: 300 req/min per IP; public guest join: 10 req/min; SSE endpoints skipped.
- Global exception filter returns a uniform envelope: `{statusCode, message, error, timestamp, path}`.
- Webhooks verify Stripe signatures and are idempotent via the `webhook_events` table.

## Billing flow

1. Register creates the organization with a 14-day trial (no card).
2. Trial cron (daily 5 AM) sends reminders (4 days and 1 day before end) and expires trials.
3. `POST /billing/subscribe` returns a Payment Element client secret (in-app payment, no redirect).
4. Webhooks (or sync-on-read in local dev) activate the subscription; `invoice.paid` triggers the payment email and Oblio invoicing.

## API contract

The backend is the single source of truth for the API contract:

- Enums live in `prisma/schema.prisma` (Prisma-generated TS enums).
- Request/response shapes are defined by DTOs annotated with Swagger decorators.
- Swagger UI (`/api/docs`) is the reference for every endpoint, model and response.

Any change to a model, enum or endpoint must be made here first, then mirrored
in `zoppex-frontend/src/lib/api/types/`.

## Conventions

- No comments in code.
- Interfaces for internal contracts, enums for states, Prisma models for persistence.
- All configuration through environment variables, validated at boot.
- YAGNI, DRY, no hardcoding.
