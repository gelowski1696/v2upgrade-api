import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MasterDataReleasesService } from '../../../application/master-data/master-data-releases.service.js';
import type { AuthenticatedUser } from '../../../domain/auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CreateMasterDataReleaseDto } from './master-data-releases.dto.js';

@ApiTags('Client master data releases')
@ApiBearerAuth()
@Controller('clients/:clientId/master-releases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MasterDataReleasesController {
  constructor(private readonly releases: MasterDataReleasesService) {}

  @Get()
  list(@Param('clientId', ParseUUIDPipe) clientId: string) {
    return this.releases.list(clientId);
  }

  @Get(':releaseId')
  get(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
  ) {
    return this.releases.get(clientId, releaseId);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  create(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() input: CreateMasterDataReleaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releases.createDraft(clientId, input, user.id);
  }

  @Post(':releaseId/publish')
  @Roles('SUPER_ADMIN', 'ADMIN')
  publish(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releases.publish(clientId, releaseId, user.id);
  }

  @Post(':releaseId/rollback')
  @Roles('SUPER_ADMIN', 'ADMIN')
  rollback(
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.releases.rollback(clientId, releaseId, user.id);
  }
}
