import { Module } from '@nestjs/common';
import { StorePrismaClientFactory } from '../infrastructure/store-database/store-prisma-client.factory.js';

@Module({
  providers: [StorePrismaClientFactory],
  exports: [StorePrismaClientFactory],
})
export class StoreDatabaseModule {}
