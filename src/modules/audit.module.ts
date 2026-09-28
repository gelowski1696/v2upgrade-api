import { Global, Module } from '@nestjs/common';
import { AUDIT_WRITER } from '../domain/audit/audit-writer.js';
import { PrismaAuditWriter } from '../infrastructure/audit/prisma-audit-writer.js';

@Global()
@Module({
  providers: [{ provide: AUDIT_WRITER, useClass: PrismaAuditWriter }],
  exports: [AUDIT_WRITER],
})
export class AuditModule {}
