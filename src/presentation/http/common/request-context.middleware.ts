import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const requestIdPattern = /^[A-Za-z0-9._:-]{1,64}$/;
const logger = new Logger('HttpRequest');

export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = validRequestId(request.get('x-request-id')) ?? randomUUID();
  request.headers['x-request-id'] = requestId;
  response.setHeader('X-Request-ID', requestId);

  const startedAt = process.hrtime.bigint();
  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const record = JSON.stringify({
      event: 'http.request_completed',
      requestId,
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs: Math.round(durationMs),
    });
    if (response.statusCode >= 500) logger.error(record);
    else if (response.statusCode >= 400) logger.warn(record);
    else logger.log(record);
  });

  next();
}

export function requestIdFrom(request: Request): string {
  return validRequestId(request.get?.('x-request-id')) ?? 'unavailable';
}

function validRequestId(value: string | undefined): string | undefined {
  return value && requestIdPattern.test(value) ? value : undefined;
}
