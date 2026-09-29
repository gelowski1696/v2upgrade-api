import { jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import {
  requestContextMiddleware,
  requestIdFrom,
} from './request-context.middleware.js';

describe('requestContextMiddleware', () => {
  it('preserves a safe caller request ID and returns it in the response', () => {
    const request = requestWithId('dashboard-request-123');
    const response = responseMock();
    const next = jest.fn() as unknown as NextFunction;

    requestContextMiddleware(request, response.value, next);

    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Request-ID',
      'dashboard-request-123',
    );
    expect(requestIdFrom(request)).toBe('dashboard-request-123');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces unsafe request IDs', () => {
    const request = requestWithId('invalid request id');
    const response = responseMock();

    requestContextMiddleware(
      request,
      response.value,
      jest.fn() as unknown as NextFunction,
    );

    const requestId = request.headers['x-request-id'];
    expect(requestId).toEqual(expect.any(String));
    expect(requestId).not.toBe('invalid request id');
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-ID', requestId);
  });
});

function requestWithId(requestId: string): Request {
  return {
    get: (name: string) =>
      name.toLowerCase() === 'x-request-id' ? requestId : undefined,
    headers: {},
    method: 'GET',
    path: '/api/v1/health',
  } as unknown as Request;
}

function responseMock() {
  const setHeader = jest.fn();
  return {
    setHeader,
    value: {
      setHeader,
      on: jest.fn(),
      statusCode: 200,
    } as unknown as Response,
  };
}
