import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PortalTenantUsersService } from '../../../application/portal/portal-tenant-users.service.js';
import type { AuthenticatedPortalUser } from '../../../domain/portal/portal-auth.types.js';
import { CurrentPortalUser } from './current-portal-user.decorator.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { CreatePortalInvitationDto } from './portal-tenant-users.dto.js';

@ApiTags('Owner portal users')
@ApiBearerAuth()
@UseGuards(PortalAuthGuard)
@Controller('portal')
export class PortalTenantUsersController {
  constructor(private readonly users: PortalTenantUsersService) {}

  @Get('users')
  list(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.users.list(user);
  }

  @Post('users/invitations')
  invite(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Body() input: CreatePortalInvitationDto,
  ) {
    return this.users.createInvitation(user, input);
  }
}
