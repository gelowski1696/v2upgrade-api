import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIT_WRITER,
  type AuditWriter,
} from '../../domain/audit/audit-writer.js';
import {
  CLIENT_REPOSITORY,
  type ClientRepository,
  type ClientStatus,
  type CreateClientInput,
  type UpdateClientInput,
} from '../../domain/clients/client.repository.js';
import { ConflictError, NotFoundError } from '../../domain/shared/errors.js';
import { ClientGroupsService } from './client-groups.service.js';

@Injectable()
export class ClientsService {
  constructor(
    @Inject(CLIENT_REPOSITORY) private readonly clients: ClientRepository,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    private readonly groups: ClientGroupsService,
  ) {}

  list(input: {
    page: number;
    pageSize: number;
    search?: string;
    status?: ClientStatus;
    groupId?: string;
  }) {
    return this.clients.list(input);
  }

  async get(id: string) {
    const client = await this.clients.findById(id);
    if (!client) throw new NotFoundError('Client');
    return client;
  }

  async create(input: CreateClientInput, actorId: string) {
    if (input.groupId) await this.groups.assertAssignable(input.groupId);
    const normalized = {
      ...input,
      code: input.code.trim().toUpperCase(),
      businessName: input.businessName.trim(),
    };
    if (await this.clients.findByCode(normalized.code)) {
      throw new ConflictError(
        'A client with this code already exists.',
        'CLIENT_CODE_EXISTS',
      );
    }
    const client = await this.clients.create(normalized);
    await this.audit.record({
      actorId,
      action: 'client.created',
      resourceType: 'client',
      resourceId: client.id,
    });
    return client;
  }

  async update(id: string, input: UpdateClientInput, actorId: string) {
    await this.get(id);
    if (input.groupId) await this.groups.assertAssignable(input.groupId);
    const client = await this.clients.update(id, input);
    await this.audit.record({
      actorId,
      action: 'client.updated',
      resourceType: 'client',
      resourceId: id,
    });
    return client;
  }

  async archive(id: string, actorId: string) {
    return this.update(id, { status: 'ARCHIVED' }, actorId);
  }
}
