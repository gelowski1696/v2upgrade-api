import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('live')
  live() {
    return this.response('ok', 'not_checked');
  }

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.response('ok', 'ok');
    } catch {
      throw new ServiceUnavailableException({
        code: 'HEALTH_DATABASE_UNAVAILABLE',
        message: 'The database health check failed.',
      });
    }
  }

  private response(status: 'ok', database: 'ok' | 'not_checked') {
    return {
      status,
      service: 'subsapi',
      version: this.config.get<string>('APP_VERSION', '0.0.1'),
      release: this.config.get<string>('APP_RELEASE', 'development'),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      checks: { database },
      timestamp: new Date().toISOString(),
    };
  }
}
