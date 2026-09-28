import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedDevice } from '../../../domain/device/device-auth.types.js';

export const CurrentDevice = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedDevice =>
    context.switchToHttp().getRequest<Request & { user: AuthenticatedDevice }>()
      .user,
);
