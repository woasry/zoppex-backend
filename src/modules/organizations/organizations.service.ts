import { Injectable } from '@nestjs/common';
import { Organization, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createWithOwner(
    userId: string,
    data: { name: string; location?: string; contactEmail?: string },
    trialDays: number,
  ): Promise<Organization> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const organization = await tx.organization.create({
        data: {
          name: data.name,
          location: data.location,
          contactEmail: data.contactEmail,
        },
      });
      await tx.membership.create({
        data: {
          userId,
          organizationId: organization.id,
          role: 'OWNER',
        },
      });
      await tx.subscription.create({
        data: {
          organizationId: organization.id,
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
        },
      });
      return organization;
    });
  }

  async listForUser(userId: string): Promise<
    { id: string; role: string; organization: Organization }[]
  > {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      organization: membership.organization,
    }));
  }
}
