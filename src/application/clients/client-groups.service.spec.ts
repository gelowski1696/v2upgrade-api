import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuditWriter } from '../../domain/audit/audit-writer.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { ClientGroupsService } from './client-groups.service.js';

describe('ClientGroupsService', () => {
  const audit: jest.Mocked<AuditWriter> = { record: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('bulk assigns unique clients to an active group', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      clientGroup: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'group-1',
          status: 'ACTIVE',
        }),
      },
      client: {
        count: jest.fn().mockResolvedValue(2),
        updateMany,
      },
    } as unknown as PrismaService;
    const service = new ClientGroupsService(prisma, audit);

    const result = await service.assign(
      ['client-1', 'client-2', 'client-1'],
      'group-1',
      'actor-1',
    );

    expect(updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: { in: ['client-1', 'client-2'] } },
      data: { groupId: 'group-1' },
    });
    expect(result).toEqual({ updated: 2, groupId: 'group-1' });
    expect(audit.record.mock.calls[0]?.[0].action).toBe(
      'client.group_assigned',
    );
  });

  it('does not assign clients to an archived group', async () => {
    const prisma = {
      clientGroup: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'group-1',
          status: 'ARCHIVED',
        }),
      },
    } as unknown as PrismaService;
    const service = new ClientGroupsService(prisma, audit);

    await expect(
      service.assign(['client-1'], 'group-1', 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
