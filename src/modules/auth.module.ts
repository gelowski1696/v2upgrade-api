import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from '../application/auth/auth.service.js';
import { PASSWORD_HASHER } from '../domain/auth/password-hasher.js';
import { USER_REPOSITORY } from '../domain/auth/user.repository.js';
import { Argon2PasswordHasher } from '../infrastructure/auth/argon2-password-hasher.js';
import { JwtStrategy } from '../infrastructure/auth/jwt.strategy.js';
import { PrismaUserRepository } from '../infrastructure/auth/prisma-user.repository.js';
import { AuthController } from '../presentation/http/auth/auth.controller.js';
import { JwtAuthGuard } from '../presentation/http/auth/jwt-auth.guard.js';
import { RolesGuard } from '../presentation/http/auth/roles.guard.js';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
  ],
  exports: [JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
