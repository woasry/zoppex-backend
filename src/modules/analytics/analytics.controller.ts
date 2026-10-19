import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { OrganizationContext } from '../../common/interfaces/request-context.interface';
import {
  AnalyticsResponse,
  AnalyticsResponseDto,
  AnalyticsService,
  OverviewStats,
  OverviewStatsDto,
} from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(OrgMemberGuard)
@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('organizations/current/overview')
  @ApiOperation({ summary: 'KPIs for the dashboard overview page' })
  @ApiOkResponse({ type: OverviewStatsDto })
  async overview(@CurrentOrganization() org: OrganizationContext): Promise<OverviewStats> {
    return this.analyticsService.getOverviewStats(org.organization.id);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Queue analytics for a time range (7-30 days)' })
  @ApiOkResponse({ type: AnalyticsResponseDto })
  async analytics(
    @CurrentOrganization() org: OrganizationContext,
    @Query('days', new DefaultValuePipe(7), ParseIntPipe) days: number,
  ): Promise<AnalyticsResponse> {
    return this.analyticsService.getAnalytics(org.organization.id, days);
  }
}
