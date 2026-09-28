import type { Page, PageQuery } from '../shared/page.js';

export type ClientStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

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
}

export interface UpdateClientInput {
  businessName?: string;
  ownerName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: ClientStatus;
}

export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');

export interface ClientRepository {
  list(
    query: PageQuery & { status?: ClientStatus },
  ): Promise<Page<ClientRecord>>;
  findById(id: string): Promise<ClientRecord | null>;
  findByCode(code: string): Promise<ClientRecord | null>;
  create(input: CreateClientInput): Promise<ClientRecord>;
  update(id: string, input: UpdateClientInput): Promise<ClientRecord>;
}
