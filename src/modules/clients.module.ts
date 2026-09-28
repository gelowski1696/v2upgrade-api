import { Module } from '@nestjs/common';
import { ClientsService } from '../application/clients/clients.service.js';
import { CLIENT_REPOSITORY } from '../domain/clients/client.repository.js';
import { PrismaClientRepository } from '../infrastructure/clients/prisma-client.repository.js';
import { ClientsController } from '../presentation/http/clients/clients.controller.js';
import { AuthModule } from './auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    { provide: CLIENT_REPOSITORY, useClass: PrismaClientRepository },
  ],
  exports: [ClientsService, CLIENT_REPOSITORY],
})
export class ClientsModule {}
