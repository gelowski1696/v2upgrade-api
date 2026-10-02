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
import { ClientGroupsService } from '../../../application/clients/client-groups.service.js';
import type { AuthenticatedUser } from '../../../domain/auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  ClientGroupPageQueryDto,
  CreateClientGroupDto,
  UpdateClientGroupDto,
} from './client-groups.dto.js';

@ApiTags('Client groups')
@ApiBearerAuth()
@Controller('client-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientGroupsController {
  constructor(private readonly groups: ClientGroupsService) {}

  @Get()
  list(@Query() query: ClientGroupPageQueryDto) {
    return this.groups.list(query);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN')
  create(
    @Body() input: CreateClientGroupDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.groups.create(input, user.id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  update(
    @Param('id') id: string,
    @Body() input: UpdateClientGroupDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.groups.update(id, input, user.id);
  }
}
