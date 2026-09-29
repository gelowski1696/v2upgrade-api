import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from '../../../application/subscriptions/subscriptions.service.js';
import type { AuthenticatedUser } from '../../../domain/auth/auth.types.js';
import type { SubscriptionStatus } from '../../../domain/subscriptions/subscription.repository.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  CreateSubscriptionDto,
  RenewSubscriptionDto,
  SubscriptionActionDto,
  SubscriptionPageQueryDto,
  UpdateFeatureModsDto,
  UpdateWebDashboardDto,
  ValidateDeviceDto,
} from './subscriptions.dto.js';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list(@Query() query: SubscriptionPageQueryDto) {
    return this.subscriptions.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.subscriptions.get(id);
  }

  @Get(':id/events')
  events(@Param('id') id: string) {
    return this.subscriptions.events(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  create(
    @Body() input: CreateSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.create(input, user.id);
  }

  @Patch(':id/device')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  assignDevice(
    @Param('id') id: string,
    @Body() input: ValidateDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.assignDevice(id, input.deviceId, user.id);
  }

  @Patch(':id/feature-mods')
  @Roles('SUPER_ADMIN', 'ADMIN')
  updateFeatureMods(
    @Param('id') id: string,
    @Body() input: UpdateFeatureModsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.updateFeatureMods(id, input.features, user.id);
  }

  @Patch(':id/web-dashboard')
  @Roles('SUPER_ADMIN', 'ADMIN')
  updateWebDashboard(
    @Param('id') id: string,
    @Body() input: UpdateWebDashboardDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.updateWebDashboard(id, input.enabled, user.id);
  }

  @Post(':id/activate')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  activate(
    @Param('id') id: string,
    @Body() input: SubscriptionActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transition(id, 'ACTIVE', user.id, input.reason);
  }

  @Post(':id/suspend')
  @Roles('SUPER_ADMIN', 'ADMIN')
  suspend(
    @Param('id') id: string,
    @Body() input: SubscriptionActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transition(id, 'SUSPENDED', user.id, input.reason);
  }

  @Post(':id/reactivate')
  @Roles('SUPER_ADMIN', 'ADMIN')
  reactivate(
    @Param('id') id: string,
    @Body() input: SubscriptionActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transition(id, 'ACTIVE', user.id, input.reason);
  }

  @Post(':id/cancel')
  @Roles('SUPER_ADMIN', 'ADMIN')
  cancel(
    @Param('id') id: string,
    @Body() input: SubscriptionActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transition(id, 'CANCELLED', user.id, input.reason);
  }

  @Post(':id/renew')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  renew(
    @Param('id') id: string,
    @Body() input: RenewSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptions.renew(id, user.id, input);
  }

  private transition(
    id: string,
    status: SubscriptionStatus,
    actorId: string,
    reason?: string,
  ) {
    return this.subscriptions.transition(id, status, actorId, reason);
  }
}
