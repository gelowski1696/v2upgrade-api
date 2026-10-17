import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedDevice } from '../../../domain/device/device-auth.types.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';

@Injectable()
export class SocialEntitlementGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedDevice }>();
    const device = await this.prisma.device.findUnique({
      where: { id: request.user.id },
      select: { subscription: { select: { entitlements: true } } },
    });
    const entitlements = this.record(device?.subscription?.entitlements);
    const key = this.featureForPath(request.path);
    if (entitlements.socialHub === false || entitlements[key] === false) {
      throw new ForbiddenException(
        'This Social Hub feature is not included in the current subscription.',
      );
    }
    return true;
  }

  private featureForPath(path: string): string {
    if (path.includes('/customer-link')) return 'socialCustomerLinking';
    if (path.includes('/commerce')) {
      return 'socialCommerce';
    }
    if (path.includes('/campaigns')) return 'socialCampaigns';
    if (path.includes('/posts/generate') || path.includes('/suggest-reply')) {
      return 'aiAssistance';
    }
    if (
      path.includes('/conversations') ||
      path.includes('/inbox') ||
      path.includes('/faqs')
    ) {
      return 'messengerInbox';
    }
    return 'socialPublishing';
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
