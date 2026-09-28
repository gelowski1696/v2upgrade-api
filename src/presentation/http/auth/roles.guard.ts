import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type {
  AuthenticatedUser,
  UserRole,
} from '../../../domain/auth/auth.types.js';
import { ROLES_KEY } from './roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed?.length) {
      return true;
    }

    const user = context.switchToHttp().getRequest<Request>().user as
      AuthenticatedUser | undefined;
    return Boolean(user && allowed.includes(user.role));
  }
}
