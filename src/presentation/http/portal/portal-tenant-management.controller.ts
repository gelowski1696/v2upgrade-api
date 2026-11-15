import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PortalTenantManagementService } from '../../../application/portal/portal-tenant-management.service.js';
import type { AuthenticatedPortalUser } from '../../../domain/portal/portal-auth.types.js';
import { CurrentPortalUser } from './current-portal-user.decorator.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { CreatePortalStoreDto } from './portal-tenant-management.dto.js';

@ApiTags('Owner portal tenant management')
@ApiBearerAuth()
@UseGuards(PortalAuthGuard)
@Controller('portal')
export class PortalTenantManagementController {
  constructor(private readonly tenant: PortalTenantManagementService) {}

  @Post('stores')
  createStore(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Body() input: CreatePortalStoreDto,
  ) {
    return this.tenant.createStore(user, input);
  }
}
