import {
  BadRequestException,
  type ArgumentsHost,
  UnprocessableEntityException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  const createHost = () => {
    const json = jest.fn();
    const response = {
      status: jest.fn().mockReturnValue({ json }),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'POST',
          path: '/api/v1/device-sync/uploads',
          url: '/api/v1/device-sync/uploads?secret=hidden',
          get: (name: string) =>
            name.toLowerCase() === 'x-request-id'
              ? 'test-request-1'
              : undefined,
        }),
      }),
    } as unknown as ArgumentsHost;

    return { host, json, status: response.status };
  };

  it('preserves structured synchronization error codes and messages', () => {
    const { host, json, status } = createHost();
    const filter = new ApiExceptionFilter();

    filter.catch(
      new UnprocessableEntityException({
        code: 'SCHEMA_INCOMPATIBLE',
        message: 'The uploaded database schema is not supported.',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        code: 'SCHEMA_INCOMPATIBLE',
        message: 'The uploaded database schema is not supported.',
        path: '/api/v1/device-sync/uploads',
        requestId: 'test-request-1',
      }),
    );
  });

  it('returns validation messages as one readable string', () => {
    const { host, json, status } = createHost();
    const filter = new ApiExceptionFilter();

    filter.catch(
      new BadRequestException({
        message: ['page must not be less than 1', 'page must be an integer'],
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'REQUEST_ERROR',
        message: 'page must not be less than 1 page must be an integer',
      }),
    );
  });
});
