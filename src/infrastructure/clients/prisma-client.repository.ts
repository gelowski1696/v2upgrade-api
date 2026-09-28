import { Injectable } from '@nestjs/common';
import type {
  ClientRecord,
  ClientRepository,
  ClientStatus,
  CreateClientInput,
  UpdateClientInput,
} from '../../domain/clients/client.repository.js';
import type { Page, PageQuery } from '../../domain/shared/page.js';
import { toPage } from '../../domain/shared/page.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class PrismaClientRepository implements ClientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: PageQuery & { status?: ClientStatus },
  ): Promise<Page<ClientRecord>> {
    const where: Prisma.ClientWhereInput = {
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { businessName: { contains: query.search, mode: 'insensitive' } },
              { ownerName: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { businessName: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.client.count({ where }),
    ]);
    return toPage(items, total, query.page, query.pageSize);
  }

  findById(id: string): Promise<ClientRecord | null> {
    return this.prisma.client.findUnique({ where: { id } });
  }

  findByCode(code: string): Promise<ClientRecord | null> {
    return this.prisma.client.findUnique({ where: { code } });
  }

  create(input: CreateClientInput): Promise<ClientRecord> {
    return this.prisma.client.create({
      data: {
        ...input,
        stores: {
          create: {
            code: 'MAIN',
            name: input.businessName,
            timezone: 'Asia/Manila',
          },
        },
      },
    });
  }

  update(id: string, input: UpdateClientInput): Promise<ClientRecord> {
    return this.prisma.client.update({ where: { id }, data: input });
  }
}
