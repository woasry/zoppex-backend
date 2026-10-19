import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { JwtPayload, OrganizationContext } from '../../common/interfaces/request-context.interface';
import { CreateInvitationDto, UpdateOrganizationDto } from './dto/organizations.dto';
import {
  InvitationResponse,
  InvitationResponseDto,
  MemberResponse,
  MemberResponseDto,
  OrganizationsService,
} from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(OrgMemberGuard)
@Controller('organizations/current')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Patch()
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  @ApiOperation({ summary: 'Update workspace identity' })
  async update(
    @CurrentOrganization() org: OrganizationContext,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(org.organization.id, dto);
  }

  @Get('members')
  @ApiOperation({ summary: 'List workspace members' })
  @ApiOkResponse({ type: [MemberResponseDto] })
  async listMembers(@CurrentOrganization() org: OrganizationContext): Promise<MemberResponse[]> {
    return this.organizationsService.listMembers(org.organization.id);
  }

  @Delete('members/:membershipId')
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  @ApiOperation({ summary: 'Remove a member from the workspace' })
  async removeMember(
    @CurrentOrganization() org: OrganizationContext,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<{ message: string }> {
    await this.organizationsService.removeMember(org.organization.id, membershipId);
    return { message: 'Member removed' };
  }

  @Get('invitations')
  @ApiOperation({ summary: 'List pending invitations' })
  @ApiOkResponse({ type: [InvitationResponseDto] })
  async listInvitations(
    @CurrentOrganization() org: OrganizationContext,
  ): Promise<InvitationResponse[]> {
    return this.organizationsService.listInvitations(org.organization.id);
  }

  @Post('invitations')
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  @ApiOperation({ summary: 'Invite a team member by email' })
  @ApiOkResponse({ type: InvitationResponseDto })
  async createInvitation(
    @CurrentOrganization() org: OrganizationContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInvitationDto,
  ): Promise<InvitationResponse> {
    return this.organizationsService.createInvitation(org.organization.id, user.sub, dto);
  }

  @Delete('invitations/:invitationId')
  @Roles(MemberRole.OWNER, MemberRole.ADMIN)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  async revokeInvitation(
    @CurrentOrganization() org: OrganizationContext,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<{ message: string }> {
    await this.organizationsService.revokeInvitation(org.organization.id, invitationId);
    return { message: 'Invitation revoked' };
  }
}
