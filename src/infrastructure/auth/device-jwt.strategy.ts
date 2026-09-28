import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedDevice } from '../../domain/device/device-auth.types.js';
import { PrismaService } from '../database/prisma.service.js';

interface DeviceTokenPayload extends AuthenticatedDevice {
  sub: string;
  tokenUse: 'device-sync';
}

@Injectable()
export class DeviceJwtStrategy extends PassportStrategy(
  Strategy,
  'device-jwt',
) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('DEVICE_JWT_SECRET'),
      audience: 'posv2-device',
      issuer: 'posv2-subscriptions',
    });
  }

  async validate(payload: DeviceTokenPayload): Promise<AuthenticatedDevice> {
    if (payload.tokenUse !== 'device-sync') {
      throw new UnauthorizedException('Invalid device credential.');
    }
    const device = await this.prisma.device.findUnique({
      where: { id: payload.sub },
      include: { client: true, store: true, subscription: true },
    });
    if (
      !device ||
      device.status !== 'ACTIVE' ||
      device.client.status !== 'ACTIVE' ||
      device.store.status !== 'ACTIVE' ||
      !device.subscription ||
      !['ACTIVE', 'TRIAL', 'GRACE'].includes(device.subscription.status)
    ) {
      throw new UnauthorizedException('Device access is unavailable.');
    }
    return {
      id: device.id,
      clientId: device.clientId,
      storeId: device.storeId,
      installationId: device.installationId,
    };
  }
}
