import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlansService } from '../../../application/plans/plans.service.js';
import type { AuthenticatedUser } from '../../../domain/auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  CreatePlanDto,
  PlanPageQueryDto,
  PlanVersionDto,
} from './plans.dto.js';

@ApiTags('Plans')
@ApiBearerAuth()
@Controller('plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list(@Query() query: PlanPageQueryDto) {
    return this.plans.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.plans.get(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  create(@Body() input: CreatePlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.create(input, user.id);
  }

  @Post(':id/versions')
  @Roles('SUPER_ADMIN', 'ADMIN')
  addVersion(
    @Param('id') id: string,
    @Body() input: PlanVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plans.addVersion(id, input, user.id);
  }

  @Post(':id/versions/:versionId/publish')
  @Roles('SUPER_ADMIN', 'ADMIN')
  publish(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.plans.publish(id, versionId, user.id);
  }

  @Post(':id/archive')
  @Roles('SUPER_ADMIN', 'ADMIN')
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.archive(id, user.id);
  }
}
