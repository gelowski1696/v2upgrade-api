import 'reflect-metadata';
import { ClientStoresService } from '../application/clients/client-stores.service.js';
import { MasterDataReleasesService } from '../application/master-data/master-data-releases.service.js';
import { PortalTenantManagementService } from '../application/portal/portal-tenant-management.service.js';
import { PortalTenantUsersService } from '../application/portal/portal-tenant-users.service.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';

describe('application dependency metadata', () => {
  it.each([
    ClientStoresService,
    MasterDataReleasesService,
    PortalTenantManagementService,
    PortalTenantUsersService,
  ])('retains the PrismaService injection token for %s', (service) => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      service,
    ) as unknown[];

    expect(parameterTypes[0]).toBe(PrismaService);
  });
});
