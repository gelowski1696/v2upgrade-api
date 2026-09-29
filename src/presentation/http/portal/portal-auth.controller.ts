import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
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
  constructor(
    private readonly portal: PortalService,
    private readonly config: ConfigService,
  ) {}

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

  @Post('web/activate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async activateWeb(
    @Body() input: PortalActivateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedWebRequest(request);
    const result = await this.portal.activate(
      input.token,
      input.password,
      this.requestContext(request),
    );
    this.setRefreshCookie(response, result.refreshToken);
    return this.withoutRefreshToken(result);
  }

  @Post('web/login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async loginWeb(
    @Body() input: PortalLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedWebRequest(request);
    const result = await this.portal.login(
      input.username,
      input.password,
      this.requestContext(request),
    );
    this.setRefreshCookie(response, result.refreshToken);
    return this.withoutRefreshToken(result);
  }

  @Post('web/refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async refreshWeb(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedWebRequest(request);
    try {
      const result = await this.portal.refresh(
        this.refreshTokenFromCookie(request),
        this.requestContext(request),
      );
      this.setRefreshCookie(response, result.refreshToken);
      return this.withoutRefreshToken(result);
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        this.clearRefreshCookie(response);
      }
      throw error;
    }
  }

  @Post('web/logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async logoutWeb(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedWebRequest(request);
    const refreshToken = this.refreshTokenFromCookie(request, false);
    this.clearRefreshCookie(response);
    if (refreshToken) await this.portal.logout(refreshToken);
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

  private assertTrustedWebRequest(request: Request): void {
    if (request.get('x-posv2-csrf') !== '1') {
      throw new ForbiddenException('Browser request verification failed.');
    }
    const origin = request.get('origin')?.replace(/\/$/, '');
    const allowedOrigins = (
      this.config.get<string>('PORTAL_WEB_ORIGINS') ??
      this.config.get<string>('CORS_ORIGINS') ??
      ''
    )
      .split(',')
      .map((value) => value.trim().replace(/\/$/, ''))
      .filter(Boolean);
    if (!origin || !allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Browser origin is not allowed.');
    }
  }

  private refreshTokenFromCookie(request: Request, required = true): string {
    const name = this.refreshCookieName();
    const cookieHeader = request.get('cookie') ?? '';
    const encodedValue = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    let value = '';
    try {
      value = encodedValue ? decodeURIComponent(encodedValue) : '';
    } catch {
      value = '';
    }
    if (required && !value) {
      throw new ForbiddenException('Browser session is unavailable.');
    }
    return value;
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    const days = this.config.get<number>('PORTAL_REFRESH_TOKEN_TTL_DAYS', 30);
    response.cookie(this.refreshCookieName(), refreshToken, {
      httpOnly: true,
      secure: this.secureCookies(),
      sameSite: 'strict',
      path: '/',
      maxAge: days * 86_400_000,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(this.refreshCookieName(), {
      httpOnly: true,
      secure: this.secureCookies(),
      sameSite: 'strict',
      path: '/',
    });
  }

  private refreshCookieName(): string {
    return this.secureCookies()
      ? '__Host-posv2-portal-refresh'
      : 'posv2-portal-refresh';
  }

  private secureCookies(): boolean {
    return this.config.get<string>('NODE_ENV', 'development') === 'production';
  }

  private withoutRefreshToken<
    T extends { accessToken: string; refreshToken: string; user: unknown },
  >(result: T): { accessToken: string; user: T['user'] } {
    return { accessToken: result.accessToken, user: result.user };
  }
}
