import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminPortalAccessService } from '../../../application/portal/admin-portal-access.service.js';
import type { AuthenticatedUser } from '../../../domain/auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  AdminPortalAccessUpdateDto,
  AdminPortalCandidateQueryDto,
  AdminPortalInvitationDto,
} from './admin-portal-access.dto.js';

@ApiTags('Admin portal access')
@ApiBearerAuth()
@Controller('admin/portal-access')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class AdminPortalAccessController {
  constructor(private readonly access: AdminPortalAccessService) {}

  @Get('candidates')
  candidates(@Query() query: AdminPortalCandidateQueryDto) {
    return this.access.candidates(query);
  }

  @Get('users')
  users(@Query() query: AdminPortalCandidateQueryDto) {
    return this.access.users(query);
  }

  @Post('invitations')
  invite(
    @Body() input: AdminPortalInvitationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.access.inviteOrAddAccess(input, actor);
  }

  @Put('users/:userId/access')
  updateAccess(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() input: AdminPortalAccessUpdateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.access.updateAccess(userId, input, actor);
  }
}
