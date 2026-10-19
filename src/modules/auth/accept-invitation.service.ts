import { Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { OrganizationsService } from '../organizations/organizations.service';

@Injectable()
export class AcceptInvitationService {
  constructor(private readonly organizationsService: OrganizationsService) {}

  async accept(userId: string, token: string): Promise<Organization> {
    return this.organizationsService.acceptInvitation(userId, token);
  }
}
