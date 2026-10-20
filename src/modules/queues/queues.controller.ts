import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QueueStatus, TicketStatus } from '@prisma/client';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';

import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { OrganizationContext } from '../../common/interfaces/request-context.interface';
import { CreateQueueDto } from './dto/create-queue.dto';
import { UpdateQueueDto } from './dto/update-queue.dto';
import { QueueActionResultDto, QueueDetailDto, QueueWithStatsDto } from './dto/response.dto';
import { QueuesService } from './queues.service';

@ApiTags('queues')
@ApiBearerAuth()
@UseGuards(OrgMemberGuard)
@Controller('queues')
export class QueuesController {
  constructor(private readonly queuesService: QueuesService) {}

  @Get()
  @ApiOperation({ summary: 'List all queues of the current organization with live stats' })
  @ApiOkResponse({ type: [QueueWithStatsDto] })
  async list(@CurrentOrganization() org: OrganizationContext): Promise<QueueWithStatsDto[]> {
    return this.queuesService.list(org.organization.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Queue detail with current and waiting tickets' })
  @ApiOkResponse({ type: QueueDetailDto })
  async findDetail(
    @CurrentOrganization() org: OrganizationContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QueueDetailDto> {
    return this.queuesService.findDetail(org.organization.id, id);
  }

  @Post()
  @UseGuards(SubscriptionGuard)
  @ApiOperation({ summary: 'Create a queue (requires an active trial or subscription)' })
  @ApiOkResponse({ type: QueueDetailDto })
  async create(
    @CurrentOrganization() org: OrganizationContext,
    @Body() dto: CreateQueueDto,
  ): Promise<QueueDetailDto> {
    return this.queuesService.create(org.organization.id, dto);
  }

  @Patch(':id')
  @UseGuards(SubscriptionGuard)
  @ApiOperation({ summary: 'Update queue configuration' })
  @ApiOkResponse({ type: QueueDetailDto })
  async update(
    @CurrentOrganization() org: OrganizationContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQueueDto,
  ): Promise<QueueDetailDto> {
    return this.queuesService.update(org.organization.id, id, dto);
  }

  @Post(':id/call-next')
  @UseGuards(SubscriptionGuard)
  @ApiOperation({ summary: 'Complete the current guest and call the next one' })
  @ApiOkResponse({ type: QueueActionResultDto })
  async callNext(
    @CurrentOrganization() org: OrganizationContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QueueActionResultDto> {
    return this.queuesService.callNext(org.organization.id, id);
  }

  @Post(':id/serve')
  @UseGuards(SubscriptionGuard)
  @ApiOperation({ summary: 'Mark the currently called guest as served' })
  @ApiOkResponse({ type: QueueActionResultDto })
  async serve(
    @CurrentOrganization() org: OrganizationContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QueueActionResultDto> {
    return this.queuesService.finishCurrent(org.organization.id, id, TicketStatus.SERVED);
  }

  @Post(':id/skip')
  @UseGuards(SubscriptionGuard)
  @ApiOperation({ summary: 'Skip the currently called guest' })
  @ApiOkResponse({ type: QueueActionResultDto })
  async skip(
    @CurrentOrganization() org: OrganizationContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QueueActionResultDto> {
    return this.queuesService.finishCurrent(org.organization.id, id, TicketStatus.SKIPPED);
  }

  @Post(':id/pause')
  @UseGuards(SubscriptionGuard)
  @ApiOperation({ summary: 'Pause the queue' })
  @ApiOkResponse({ type: QueueActionResultDto })
  async pause(
    @CurrentOrganization() org: OrganizationContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QueueActionResultDto> {
    return this.queuesService.setStatus(org.organization.id, id, QueueStatus.PAUSED);
  }

  @Post(':id/resume')
  @UseGuards(SubscriptionGuard)
  @ApiOperation({ summary: 'Resume the queue' })
  @ApiOkResponse({ type: QueueActionResultDto })
  async resume(
    @CurrentOrganization() org: OrganizationContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QueueActionResultDto> {
    return this.queuesService.setStatus(org.organization.id, id, QueueStatus.ACTIVE);
  }
}

