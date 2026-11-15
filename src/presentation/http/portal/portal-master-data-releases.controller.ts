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
import { PortalMasterDataReleasesService } from '../../../application/portal/portal-master-data-releases.service.js';
import type { AuthenticatedPortalUser } from '../../../domain/portal/portal-auth.types.js';
import { CurrentPortalUser } from './current-portal-user.decorator.js';
import { PortalAuthGuard } from './portal-auth.guard.js';
import { CreateMasterDataReleaseDto } from '../clients/master-data-releases.dto.js';

@ApiTags('Owner portal master data')
@ApiBearerAuth()
@UseGuards(PortalAuthGuard)
@Controller('portal/master-releases')
export class PortalMasterDataReleasesController {
  constructor(private readonly releases: PortalMasterDataReleasesService) {}

  @Get()
  list(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.releases.list(user);
  }

  @Get(':releaseId')
  get(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
  ) {
    return this.releases.get(user, releaseId);
  }

  @Post()
  create(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Body() input: CreateMasterDataReleaseDto,
  ) {
    return this.releases.createDraft(user, input);
  }

  @Post(':releaseId/publish')
  publish(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
  ) {
    return this.releases.publish(user, releaseId);
  }

  @Post(':releaseId/rollback')
  rollback(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('releaseId', ParseUUIDPipe) releaseId: string,
  ) {
    return this.releases.rollback(user, releaseId);
  }
}
