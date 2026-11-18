import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthenticatedPortalUser } from '../../domain/portal/portal-auth.types.js';
import {
  cloudMasterDataEnabled,
  featureModsFromEntitlements,
} from '../../domain/subscriptions/feature-mods.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

const ACTIVE_SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE'] as const;
const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;

export interface CreateDeviceEnrollmentInput {
  label?: string;
  expiresInMinutes?: number;
}

export interface ConsumeDeviceEnrollmentInput {
  enrollmentCode: string;
  installationId: string;
  label?: string;
  platform: string;
  appVersion?: string;
}

@Injectable()
export class DeviceEnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async create(
    user: AuthenticatedPortalUser,
    storeId: string,
    input: CreateDeviceEnrollmentInput,
  ) {
    this.requireOwner(user);
    const expiresInMinutes =
      input.expiresInMinutes ??
      this.config.get<number>('DEVICE_ENROLLMENT_TTL_MINUTES', 30);
    if (
      !Number.isInteger(expiresInMinutes) ||
      expiresInMinutes < 5 ||
      expiresInMinutes > 1_440
    ) {
      throw new BadRequestException(
        'Enrollment expiry must be between 5 minutes and 24 hours.',
      );
    }
    const label = input.label?.trim() || null;
    const enrollmentCode = this.generateCode();
    const tokenHash = this.hashCode(enrollmentCode);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

    const record = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "clients" WHERE "id" = ${user.clientId}::uuid FOR UPDATE
      `;
      const store = await transaction.store.findFirst({
        where: { id: storeId, clientId: user.clientId, status: 'ACTIVE' },
        select: { id: true, code: true, name: true, status: true },
      });
      if (!store) throw new NotFoundException('Branch was not found.');
      const subscription = await transaction.subscription.findFirst({
        where: {
          clientId: user.clientId,
          deletedAt: null,
          status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, maxDevices: true, entitlements: true },
      });
      if (!subscription) {
        throw new ForbiddenException(
          'An active subscription is required to enroll a device.',
        );
      }
      if (!cloudMasterDataEnabled(subscription.entitlements)) {
        throw new ForbiddenException(
          'Cloud-managed master data is not enabled for this subscription.',
        );
      }
      const activeDevices = await transaction.device.count({
        where: { subscriptionId: subscription.id, status: 'ACTIVE' },
      });
      if (activeDevices >= subscription.maxDevices) {
        throw new ConflictException(
          `This subscription allows ${subscription.maxDevices} active device${subscription.maxDevices === 1 ? '' : 's'}.`,
        );
      }
      const created = await transaction.deviceEnrollmentCode.create({
        data: {
          clientId: user.clientId,
          subscriptionId: subscription.id,
          storeId: store.id,
          tokenHash,
          label,
          expiresAt,
          createdByPortalUserId: user.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'device.enrollment_created',
          resourceType: 'device_enrollment_code',
          resourceId: created.id,
          metadata: {
            portalUserId: user.id,
            clientId: user.clientId,
            storeId: store.id,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
      return { ...created, store };
    });

    return {
      id: record.id,
      enrollmentCode,
      label: record.label,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      store: {
        id: record.store.id,
        code: record.store.code,
        name: record.store.name,
      },
    };
  }

  async list(user: AuthenticatedPortalUser, storeId: string) {
    this.requireOwner(user);
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, clientId: user.clientId },
      select: { id: true, code: true, name: true },
    });
    if (!store) throw new NotFoundException('Branch was not found.');
    const [codes, devices] = await Promise.all([
      this.prisma.deviceEnrollmentCode.findMany({
        where: { clientId: user.clientId, storeId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          label: true,
          expiresAt: true,
          consumedAt: true,
          revokedAt: true,
          createdAt: true,
          consumedByDeviceId: true,
        },
      }),
      this.prisma.device.findMany({
        where: { clientId: user.clientId, storeId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          installationId: true,
          label: true,
          platform: true,
          appVersion: true,
          status: true,
          lastSeenAt: true,
          createdAt: true,
        },
      }),
    ]);
    const now = Date.now();
    return {
      store,
      enrollments: codes.map((code) => ({
        ...code,
        status: code.consumedAt
          ? 'CONSUMED'
          : code.revokedAt
            ? 'REVOKED'
            : code.expiresAt.getTime() <= now
              ? 'EXPIRED'
              : 'ACTIVE',
      })),
      devices,
    };
  }

  async revoke(
    user: AuthenticatedPortalUser,
    storeId: string,
    enrollmentId: string,
  ): Promise<void> {
    this.requireOwner(user);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "device_enrollment_codes" WHERE "id" = ${enrollmentId}::uuid FOR UPDATE
      `;
      const record = await transaction.deviceEnrollmentCode.findFirst({
        where: { id: enrollmentId, clientId: user.clientId, storeId },
        select: { id: true, consumedAt: true, revokedAt: true },
      });
      if (!record) throw new NotFoundException('Enrollment was not found.');
      if (record.consumedAt) {
        throw new ConflictException('A consumed enrollment cannot be revoked.');
      }
      if (record.revokedAt) return;
      await transaction.deviceEnrollmentCode.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          action: 'device.enrollment_revoked',
          resourceType: 'device_enrollment_code',
          resourceId: record.id,
          metadata: { portalUserId: user.id, clientId: user.clientId, storeId },
        },
      });
    });
  }

  async consume(input: ConsumeDeviceEnrollmentInput) {
    const normalizedCode = input.enrollmentCode.trim().toUpperCase();
    const installationId = input.installationId.trim().toUpperCase();
    const platform = input.platform.trim().toLowerCase();
    if (!/^VMJAM-[A-Z0-9-]{19,64}$/.test(normalizedCode)) {
      throw new UnauthorizedException('Enrollment code is invalid.');
    }
    if (!INSTALLATION_ID_PATTERN.test(installationId)) {
      throw new BadRequestException('Installation ID is invalid.');
    }
    if (!platform || platform.length > 40) {
      throw new BadRequestException('Device platform is invalid.');
    }
    const tokenHash = this.hashCode(normalizedCode);
    const now = new Date();

    const enrolled = await this.prisma.$transaction(async (transaction) => {
      const initial = await transaction.deviceEnrollmentCode.findUnique({
        where: { tokenHash },
        select: { id: true, subscriptionId: true },
      });
      if (!initial) {
        throw new UnauthorizedException('Enrollment code is invalid.');
      }
      await transaction.$queryRaw`
        SELECT "id" FROM "device_enrollment_codes" WHERE "id" = ${initial.id}::uuid FOR UPDATE
      `;
      await transaction.$queryRaw`
        SELECT "id" FROM "subscriptions" WHERE "id" = ${initial.subscriptionId}::uuid FOR UPDATE
      `;
      const code = await transaction.deviceEnrollmentCode.findUnique({
        where: { id: initial.id },
        include: {
          store: { select: { id: true, code: true, name: true, status: true } },
          subscription: {
            include: {
              client: { select: { businessName: true, status: true } },
              planVersion: { include: { plan: { select: { name: true } } } },
            },
          },
        },
      });
      if (!code) throw new UnauthorizedException('Enrollment code is invalid.');
      if (code.consumedAt) {
        throw new ConflictException('Enrollment code has already been used.');
      }
      if (code.revokedAt) throw new GoneException('Enrollment code was revoked.');
      if (code.expiresAt <= now) throw new GoneException('Enrollment code has expired.');
      if (
        code.store.status !== 'ACTIVE' ||
        code.subscription.client.status !== 'ACTIVE' ||
        !ACTIVE_SUBSCRIPTION_STATUSES.includes(
          code.subscription.status as (typeof ACTIVE_SUBSCRIPTION_STATUSES)[number],
        ) ||
        code.subscription.startsAt > now ||
        (code.subscription.status === 'GRACE'
          ? code.subscription.graceEndsAt && code.subscription.graceEndsAt < now
          : code.subscription.expiresAt && code.subscription.expiresAt < now) ||
        !cloudMasterDataEnabled(code.subscription.entitlements)
      ) {
        throw new ForbiddenException('Device enrollment is not available.');
      }
      const existing = await transaction.device.findUnique({
        where: { installationId },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('This installation is already enrolled.');
      }
      const activeDevices = await transaction.device.count({
        where: { subscriptionId: code.subscriptionId, status: 'ACTIVE' },
      });
      if (activeDevices >= code.subscription.maxDevices) {
        throw new ConflictException('The subscription device limit has been reached.');
      }
      const device = await transaction.device.create({
        data: {
          clientId: code.clientId,
          subscriptionId: code.subscriptionId,
          storeId: code.storeId,
          installationId,
          label: input.label?.trim() || code.label || 'Windows POS',
          platform,
          appVersion: input.appVersion?.trim() || null,
          lastSeenAt: now,
        },
      });
      await transaction.deviceEnrollmentCode.update({
        where: { id: code.id },
        data: { consumedAt: now, consumedByDeviceId: device.id },
      });
      await transaction.auditLog.create({
        data: {
          action: 'device.enrollment_consumed',
          resourceType: 'device',
          resourceId: device.id,
          metadata: {
            enrollmentId: code.id,
            clientId: code.clientId,
            storeId: code.storeId,
            platform,
          },
        },
      });
      return { device, code };
    });

    const deviceAccessToken = await this.jwt.signAsync(
      {
        sub: enrolled.device.id,
        clientId: enrolled.device.clientId,
        storeId: enrolled.device.storeId,
        installationId: enrolled.device.installationId,
        tokenUse: 'device-sync',
      },
      {
        secret: this.config.getOrThrow<string>('DEVICE_JWT_SECRET'),
        audience: 'posv2-device',
        issuer: 'posv2-subscriptions',
        expiresIn: this.config.get<string>(
          'DEVICE_TOKEN_TTL',
          '12h',
        ) as SignOptions['expiresIn'],
      },
    );
    return {
      deviceAccessToken,
      tenantId: enrolled.device.clientId,
      device: {
        id: enrolled.device.id,
        installationId: enrolled.device.installationId,
        label: enrolled.device.label,
      },
      store: {
        id: enrolled.code.store.id,
        code: enrolled.code.store.code,
        name: enrolled.code.store.name,
      },
      subscription: {
        id: enrolled.code.subscription.id,
        status: enrolled.code.subscription.status,
        clientName: enrolled.code.subscription.client.businessName,
        planName: enrolled.code.subscription.planVersion.plan.name,
        expiresAt: enrolled.code.subscription.expiresAt,
        graceEndsAt: enrolled.code.subscription.graceEndsAt,
      },
      featureMods: featureModsFromEntitlements(
        enrolled.code.subscription.entitlements as Record<string, unknown>,
      ),
      enrolledAt: now,
    };
  }

  private requireOwner(user: AuthenticatedPortalUser): void {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException('Only the tenant owner can enroll devices.');
    }
  }

  private generateCode(): string {
    const value = randomBytes(15)
      .toString('base64url')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 20);
    return `VMJAM-${value.match(/.{1,4}/g)?.join('-') ?? value}`;
  }

  private hashCode(value: string): string {
    return createHash('sha256').update(value.trim().toUpperCase()).digest('hex');
  }
}
