import type { Page, PageQuery } from '../shared/page.js';

export type ClientStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ClientGroupStatus = 'ACTIVE' | 'ARCHIVED';

export interface ClientGroupSummary {
  id: string;
  code: string;
  name: string;
  status: ClientGroupStatus;
}

export interface ClientRecord {
  id: string;
  code: string;
  businessName: string;
  ownerName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  status: ClientStatus;
  groupId: string | null;
  group: ClientGroupSummary | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClientInput {
  code: string;
  businessName: string;
  ownerName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  groupId?: string;
}

export interface UpdateClientInput {
  businessName?: string;
  ownerName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: ClientStatus;
  groupId?: string | null;
}

export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');

export interface ClientRepository {
  list(
    query: PageQuery & { status?: ClientStatus; groupId?: string },
  ): Promise<Page<ClientRecord>>;
  findById(id: string): Promise<ClientRecord | null>;
  findByCode(code: string): Promise<ClientRecord | null>;
  create(input: CreateClientInput): Promise<ClientRecord>;
  update(id: string, input: UpdateClientInput): Promise<ClientRecord>;
}
