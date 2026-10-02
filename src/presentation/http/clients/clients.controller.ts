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
import { ClientsService } from '../../../application/clients/clients.service.js';
import { ClientGroupsService } from '../../../application/clients/client-groups.service.js';
import type { AuthenticatedUser } from '../../../domain/auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  ClientPageQueryDto,
  CreateClientDto,
  UpdateClientDto,
  AssignClientGroupDto,
  BulkAssignClientGroupDto,
} from './clients.dto.js';

@ApiTags('Clients')
@ApiBearerAuth()
@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly groups: ClientGroupsService,
  ) {}

  @Get()
  list(@Query() query: ClientPageQueryDto) {
    return this.clients.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.clients.get(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  create(
    @Body() input: CreateClientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.create(input, user.id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  update(
    @Param('id') id: string,
    @Body() input: UpdateClientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.update(id, input, user.id);
  }

  @Patch(':id/group')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  assignGroup(
    @Param('id') id: string,
    @Body() input: AssignClientGroupDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.groups.assign([id], input.groupId ?? null, user.id);
  }

  @Post('bulk-group')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  bulkAssignGroup(
    @Body() input: BulkAssignClientGroupDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.groups.assign(input.clientIds, input.groupId ?? null, user.id);
  }

  @Post(':id/archive')
  @Roles('SUPER_ADMIN', 'ADMIN')
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.archive(id, user.id);
  }
}
