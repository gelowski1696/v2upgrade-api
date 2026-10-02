import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AUDIT_WRITER,
  type AuditWriter,
} from '../../domain/audit/audit-writer.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

@Injectable()
export class ClientGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
  ) {}

  async list(query: {
    page: number;
    pageSize: number;
    search?: string;
    status?: 'ACTIVE' | 'ARCHIVED';
  }) {
    const search = query.search?.trim();
    const where = {
      status: query.status,
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.clientGroup.findMany({
        where,
        include: { _count: { select: { clients: true } } },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.clientGroup.count({ where }),
    ]);
    return {
      items: items.map(({ _count, ...group }) => ({
        ...group,
        clientCount: _count.clients,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async create(
    input: { code: string; name: string; description?: string },
    actorId: string,
  ) {
    try {
      const group = await this.prisma.clientGroup.create({
        data: {
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          createdById: actorId,
        },
        include: { _count: { select: { clients: true } } },
      });
      await this.audit.record({
        actorId,
        action: 'client_group.created',
        resourceType: 'client_group',
        resourceId: group.id,
      });
      const { _count, ...record } = group;
      return { ...record, clientCount: _count.clients };
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async update(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      status?: 'ACTIVE' | 'ARCHIVED';
    },
    actorId: string,
  ) {
    await this.requireGroup(id);
    try {
      const group = await this.prisma.clientGroup.update({
        where: { id },
        data: {
          name: input.name?.trim(),
          description:
            input.description === undefined
              ? undefined
              : input.description?.trim() || null,
          status: input.status,
        },
        include: { _count: { select: { clients: true } } },
      });
      await this.audit.record({
        actorId,
        action: 'client_group.updated',
        resourceType: 'client_group',
        resourceId: id,
        metadata: { status: input.status },
      });
      const { _count, ...record } = group;
      return { ...record, clientCount: _count.clients };
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async assign(clientIds: string[], groupId: string | null, actorId: string) {
    const uniqueIds = [...new Set(clientIds)];
    if (!uniqueIds.length) {
      throw new BadRequestException('Select at least one client.');
    }
    if (groupId) {
      const group = await this.requireGroup(groupId);
      if (group.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Archived groups cannot receive clients.',
        );
      }
    }
    const existing = await this.prisma.client.count({
      where: { id: { in: uniqueIds } },
    });
    if (existing !== uniqueIds.length) {
      throw new NotFoundException('One or more clients were not found.');
    }
    await this.prisma.client.updateMany({
      where: { id: { in: uniqueIds } },
      data: { groupId },
    });
    await this.audit.record({
      actorId,
      action: 'client.group_assigned',
      resourceType: 'client',
      metadata: { clientIds: uniqueIds, groupId },
    });
    return { updated: uniqueIds.length, groupId };
  }

  async assertAssignable(groupId: string): Promise<void> {
    const group = await this.requireGroup(groupId);
    if (group.status !== 'ACTIVE') {
      throw new BadRequestException('Archived groups cannot receive clients.');
    }
  }

  private async requireGroup(id: string) {
    const group = await this.prisma.clientGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Client group not found.');
    return group;
  }

  private rethrowUnique(error: unknown): never {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : null;
    if (code === 'P2002') {
      throw new ConflictException(
        'A client group with this code or name already exists.',
      );
    }
    throw error;
  }
}
