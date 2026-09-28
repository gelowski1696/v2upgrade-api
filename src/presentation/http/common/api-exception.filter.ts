import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../../../domain/shared/errors.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();

    if (error instanceof DomainError) {
      response.status(error.status).json({
        statusCode: error.status,
        code: error.code,
        message: error.message,
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      const details =
        typeof body === 'object' && body !== null
          ? (body as { code?: unknown; message?: unknown })
          : null;
      const rawMessage = details?.message ?? body;
      const message = Array.isArray(rawMessage)
        ? rawMessage.map(String).join(' ')
        : typeof rawMessage === 'string'
          ? rawMessage
          : error.message;
      response.status(status).json({
        statusCode: status,
        code:
          typeof details?.code === 'string'
            ? details.code
            : status === 401
              ? 'UNAUTHORIZED'
              : 'REQUEST_ERROR',
        message,
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    console.error(error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
