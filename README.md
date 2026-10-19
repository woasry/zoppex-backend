# ZOPPEX Backend

NestJS API for the ZOPPEX queue management platform.

## Stack

- NestJS 11, TypeScript strict
- Prisma ORM + PostgreSQL 14
- class-validator / class-transformer DTO validation
- Swagger (OpenAPI) at `/api/docs`
- Nodemailer (SMTP via CPanel, console driver for local dev)

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
├── config/          env validation + typed configuration
├── common/          guards, filters, interceptors, decorators
├── prisma/          PrismaModule + PrismaService
└── modules/
    ├── auth/        register, login, refresh, logout, email verification
    ├── users/
    ├── organizations/ workspace, memberships, invitations
    ├── queues/      CRUD + queue lifecycle operations
    ├── tickets/     public guest endpoints (join, ticket status)
    ├── activity/    activity feed
    ├── analytics/   SQL aggregations
    ├── realtime/    SSE event streams
    ├── billing/     Stripe subscriptions + webhooks
    ├── invoicing/   Oblio invoicing
    └── notifications/ email templates + sending
```

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
