import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

interface SeedTicket {
  number: string;
  displayName: string | null;
  status: 'WAITING' | 'CALLED';
  minutesAgo: number;
}

interface SeedQueue {
  name: string;
  code: string;
  service: string;
  status: 'ACTIVE' | 'PAUSED';
  avgMinutes: number;
  desks: number;
  ticketSequence: number;
  tickets: SeedTicket[];
}

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

const seedQueues: SeedQueue[] = [
  {
    name: 'Main Reception',
    code: 'A',
    service: 'Walk-in assistance',
    status: 'ACTIVE',
    avgMinutes: 5,
    desks: 2,
    ticketSequence: 30,
    tickets: [
      { number: 'A023', displayName: 'Morgan Blake', status: 'CALLED', minutesAgo: 26 },
      { number: 'A024', displayName: 'Olivia Harris', status: 'WAITING', minutesAgo: 24 },
      { number: 'A025', displayName: 'Daniel Reed', status: 'WAITING', minutesAgo: 22 },
      { number: 'A026', displayName: 'Avery Clarke', status: 'WAITING', minutesAgo: 18 },
      { number: 'A027', displayName: 'Jamie Wilson', status: 'WAITING', minutesAgo: 15 },
      { number: 'A028', displayName: 'Taylor Lee', status: 'WAITING', minutesAgo: 11 },
      { number: 'A029', displayName: 'Alex Morgan', status: 'WAITING', minutesAgo: 8 },
    ],
  },
  {
    name: 'Consultation Desk',
    code: 'B',
    service: 'Personal appointments',
    status: 'ACTIVE',
    avgMinutes: 9,
    desks: 2,
    ticketSequence: 17,
    tickets: [
      { number: 'B013', displayName: 'Sophia Parker', status: 'CALLED', minutesAgo: 27 },
      { number: 'B014', displayName: 'Noah Evans', status: 'WAITING', minutesAgo: 16 },
      { number: 'B015', displayName: 'Charlie Moore', status: 'WAITING', minutesAgo: 13 },
      { number: 'B016', displayName: 'Mia Foster', status: 'WAITING', minutesAgo: 9 },
    ],
  },
  {
    name: 'Service Desk',
    code: 'C',
    service: 'Customer support',
    status: 'PAUSED',
    avgMinutes: 6,
    desks: 1,
    ticketSequence: 9,
    tickets: [
      { number: 'C007', displayName: 'Chris Brooks', status: 'WAITING', minutesAgo: 14 },
      { number: 'C008', displayName: 'Robin Ellis', status: 'WAITING', minutesAgo: 5 },
    ],
  },
];

async function main(): Promise<void> {
  const passwordHash = await argon2.hash('Password123!');

  const owner = await prisma.user.create({
    data: {
      email: 'owner@zoppex.dev',
      passwordHash,
      firstName: 'Alex',
      lastName: 'Morgan',
      emailVerifiedAt: new Date(),
    },
  });

  const organization = await prisma.organization.create({
    data: {
      name: 'Atelier Studio',
      location: 'London, United Kingdom',
      contactEmail: 'hello@atelier.example',
    },
  });

  await prisma.membership.create({
    data: {
      userId: owner.id,
      organizationId: organization.id,
      role: 'OWNER',
    },
  });

  await prisma.subscription.create({
    data: {
      organizationId: organization.id,
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  for (const seedQueue of seedQueues) {
    const queue = await prisma.queue.create({
      data: {
        organizationId: organization.id,
        name: seedQueue.name,
        code: seedQueue.code,
        service: seedQueue.service,
        status: seedQueue.status,
        avgMinutes: seedQueue.avgMinutes,
        desks: seedQueue.desks,
        ticketSequence: seedQueue.ticketSequence,
      },
    });

    for (const seedTicket of seedQueue.tickets) {
      await prisma.ticket.create({
        data: {
          queueId: queue.id,
          number: seedTicket.number,
          displayName: seedTicket.displayName,
          status: seedTicket.status,
          joinedAt: minutesAgo(seedTicket.minutesAgo),
          calledAt: seedTicket.status === 'CALLED' ? minutesAgo(seedTicket.minutesAgo - 1) : null,
        },
      });
    }

    await prisma.activityEvent.create({
      data: {
        organizationId: organization.id,
        queueId: queue.id,
        type: 'QUEUE_CREATED',
        payload: { queueName: seedQueue.name },
        createdAt: minutesAgo(40),
      },
    });
  }

  console.log('Seed completed: owner@zoppex.dev / Password123!');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
