import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedPortalUser } from '../../../domain/portal/portal-auth.types.js';

export const CurrentPortalUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPortalUser =>
    context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedPortalUser }>().user,
);
