import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { OrganizationContext } from '../../common/interfaces/request-context.interface';
import { ActivityEventResponse, ActivityEventResponseDto, ActivityService } from './activity.service';

@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(OrgMemberGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  @ApiOperation({ summary: 'Latest activity events for the organization' })
  @ApiOkResponse({ type: [ActivityEventResponseDto] })
  async list(
    @CurrentOrganization() org: OrganizationContext,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<ActivityEventResponse[]> {
    return this.activityService.list(org.organization.id, limit);
  }
}
