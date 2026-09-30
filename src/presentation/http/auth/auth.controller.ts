import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import {
  AuthService,
  type AuthResult,
} from '../../../application/auth/auth.service.js';
import type { AuthenticatedUser } from '../../../domain/auth/auth.types.js';
import { CurrentUser } from './current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { LoginDto, RefreshTokenDto, WebLoginDto } from './auth.dto.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  login(@Body() input: LoginDto): Promise<AuthResult> {
    return this.auth.login(input.username, input.password);
  }

  @Post('web/login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async loginWeb(
    @Body() input: WebLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedWebRequest(request);
    const result = await this.auth.loginWeb(
      input.username,
      input.password,
      input.rememberMe,
    );
    this.setRefreshCookie(response, result.refreshToken, result.persistent);
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
      const result = await this.auth.refreshWeb(
        this.refreshTokenFromCookie(request),
      );
      this.setRefreshCookie(response, result.refreshToken, result.persistent);
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
  ): Promise<void> {
    this.assertTrustedWebRequest(request);
    const refreshToken = this.refreshTokenFromCookie(request, false);
    this.clearRefreshCookie(response);
    if (refreshToken) await this.auth.logout(refreshToken);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() input: RefreshTokenDto): Promise<AuthResult> {
    return this.auth.refresh(input.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Body() input: RefreshTokenDto): Promise<void> {
    return this.auth.logout(input.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  private assertTrustedWebRequest(request: Request): void {
    if (request.get('x-posv2-csrf') !== '1') {
      throw new ForbiddenException('Browser request verification failed.');
    }
    const origin = request.get('origin')?.replace(/\/$/, '');
    const allowedOrigins = this.config
      .get<string>(
        'ADMIN_WEB_ORIGINS',
        'http://localhost:4200,http://127.0.0.1:4200',
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

  private setRefreshCookie(
    response: Response,
    refreshToken: string,
    persistent: boolean,
  ): void {
    const options: CookieOptions = {
      httpOnly: true,
      secure: this.secureCookies(),
      sameSite: 'strict',
      path: '/',
    };
    if (persistent) {
      options.maxAge =
        this.config.get<number>('ADMIN_REMEMBER_LOGIN_TTL_DAYS', 30) *
        86_400_000;
    }
    response.cookie(this.refreshCookieName(), refreshToken, options);
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
      ? '__Host-posv2-admin-refresh'
      : 'posv2-admin-refresh';
  }

  private secureCookies(): boolean {
    return this.config.get<string>('NODE_ENV', 'development') === 'production';
  }

  private withoutRefreshToken<T extends AuthResult>(result: T) {
    return { accessToken: result.accessToken, user: result.user };
  }
}
