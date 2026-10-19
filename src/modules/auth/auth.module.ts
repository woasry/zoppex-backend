import { Module } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { AcceptInvitationService } from './accept-invitation.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [AuthController],
  providers: [AuthService, AcceptInvitationService],
  exports: [AuthService],
})
export class AuthModule {}
