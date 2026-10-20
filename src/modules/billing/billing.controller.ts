import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEnum } from 'class-validator';
import { BillingCurrency, BillingInterval } from '@prisma/client';

import { MemberRole } from '@prisma/client';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { JwtPayload, OrganizationContext } from '../../common/interfaces/request-context.interface';
import { BillingService, BillingStatusDto, SubscribeResponseDto } from './billing.service';

export class SubscribeRequestDto {
  @IsEnum(BillingInterval)
  interval: BillingInterval;

  @IsEnum(BillingCurrency)
  currency: BillingCurrency;
}

export class CancelRequestDto {
  @IsBoolean()
  cancel: boolean;
}

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(OrgMemberGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('status')
  @ApiOperation({ summary: 'Current subscription status (synced with Stripe)' })
  @ApiOkResponse({ type: BillingStatusDto })
  async status(@CurrentOrganization() org: OrganizationContext): Promise<BillingStatusDto> {
    return this.billingService.getStatus(org.organization.id);
  }

  @Post('subscribe')
  @Roles(MemberRole.OWNER)
  @ApiOperation({ summary: 'Start a subscription (returns a Payment Element client secret)' })
  @ApiOkResponse({ type: SubscribeResponseDto })
  async subscribe(
    @CurrentOrganization() org: OrganizationContext,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SubscribeRequestDto,
  ): Promise<SubscribeResponseDto> {
    return this.billingService.subscribe(
      org.organization.id,
      user.email,
      org.organization.name,
      dto,
    );
  }

  @Post('cancel')
  @Roles(MemberRole.OWNER)
  @ApiOperation({ summary: 'Cancel at period end, or resume a scheduled cancellation' })
  async cancel(
    @CurrentOrganization() org: OrganizationContext,
    @Body() dto: CancelRequestDto,
  ): Promise<{ message: string }> {
    await this.billingService.setCancelAtPeriodEnd(org.organization.id, dto.cancel);
    return { message: dto.cancel ? 'Subscription will end at period end' : 'Cancellation reverted' };
  }
}
