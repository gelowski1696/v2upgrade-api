import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PortalService } from '../../../application/portal/portal.service.js';
import type { AuthenticatedPortalUser } from '../../../domain/portal/portal-auth.types.js';
import { CurrentPortalUser } from './current-portal-user.decorator.js';
import {
  PortalActivateDto,
  PortalChangePasswordDto,
  PortalLoginDto,
  PortalRefreshDto,
  PortalResetPasswordDto,
} from './portal-auth.dto.js';
import { PortalAuthGuard } from './portal-auth.guard.js';

@ApiTags('Owner portal authentication')
@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly portal: PortalService) {}

  @Post('activate')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  activate(@Body() input: PortalActivateDto, @Req() request: Request) {
    return this.portal.activate(
      input.token,
      input.password,
      this.requestContext(request),
    );
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  login(@Body() input: PortalLoginDto, @Req() request: Request) {
    return this.portal.login(
      input.username,
      input.password,
      this.requestContext(request),
    );
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() input: PortalRefreshDto, @Req() request: Request) {
    return this.portal.refresh(
      input.refreshToken,
      this.requestContext(request),
    );
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Body() input: PortalRefreshDto) {
    return this.portal.logout(input.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(PortalAuthGuard)
  me(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return user;
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(PortalAuthGuard)
  changePassword(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Body() input: PortalChangePasswordDto,
  ) {
    return this.portal.changePassword(
      user,
      input.currentPassword,
      input.newPassword,
    );
  }

  @Post('reset-password')
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  resetPassword(@Body() input: PortalResetPasswordDto) {
    return this.portal.resetPassword(input.token, input.newPassword);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @UseGuards(PortalAuthGuard)
  sessions(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.portal.listSessions(user);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(PortalAuthGuard)
  revokeSession(
    @CurrentPortalUser() user: AuthenticatedPortalUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.portal.revokeSession(user, sessionId);
  }

  @Post('sessions/revoke-others')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(PortalAuthGuard)
  revokeOtherSessions(@CurrentPortalUser() user: AuthenticatedPortalUser) {
    return this.portal.revokeOtherSessions(user);
  }

  private requestContext(request: Request) {
    return {
      userAgent: request.get('user-agent'),
      ipAddress: request.ip,
    };
  }
}
