/**
 * T5.01 correlation propagation (F-11, F-13; AC-F11-1, AC-F13-1).
 *
 * Covers the context helpers, the middleware header echo, the error body
 * contract and one real Nest application so the global route registration is
 * exercised rather than assumed.
 */

import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CORRELATION_ID_HEADER,
  currentCorrelationId,
  normalizeCorrelationId,
  resolveCorrelationId,
  runWithCorrelationId,
} from './correlation.js';
import { CorrelationModule } from './correlation.module.js';

@Controller()
class ProbeController {
  @Get('probe')
  probe(): { correlationId: string | null } {
    return { correlationId: currentCorrelationId() ?? null };
  }

  @Get('boom')
  boom(): never {
    throw new ForbiddenException('not allowed');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('correlation id helpers', () => {
  it('keeps a safe client value unchanged', () => {
    expect(normalizeCorrelationId('trace-abc_1:2.3')).toBe('trace-abc_1:2.3');
  });

  it('rejects unsafe or overlong client values instead of repairing them', () => {
    expect(normalizeCorrelationId('trace abc')).toBeUndefined();
    expect(normalizeCorrelationId('trace\ninjected')).toBeUndefined();
    expect(normalizeCorrelationId('x'.repeat(129))).toBeUndefined();
    expect(normalizeCorrelationId('')).toBeUndefined();
    expect(normalizeCorrelationId(['a', 'b'])).toBeUndefined();
    expect(normalizeCorrelationId(undefined)).toBeUndefined();
  });

  it('generates a UUID when the client value is absent or unsafe', () => {
    expect(resolveCorrelationId(undefined)).toMatch(UUID);
    expect(resolveCorrelationId('bad value')).toMatch(UUID);
  });

  it('exposes the id only inside the context and keeps nested runs separate', () => {
    expect(currentCorrelationId()).toBeUndefined();

    runWithCorrelationId('outer', () => {
      expect(currentCorrelationId()).toBe('outer');
      runWithCorrelationId('inner', () => {
        expect(currentCorrelationId()).toBe('inner');
      });
      expect(currentCorrelationId()).toBe('outer');
    });

    expect(currentCorrelationId()).toBeUndefined();
  });
});

describe('HTTP correlation propagation', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CorrelationModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('echoes a safe client id and makes it visible to the handler', async () => {
    const response = await request(app.getHttpServer())
      .get('/probe')
      .set(CORRELATION_ID_HEADER, 'trace-abc')
      .expect(200);

    expect(response.headers[CORRELATION_ID_HEADER]).toBe('trace-abc');
    expect(response.body).toEqual({ correlationId: 'trace-abc' });
  });

  it('generates an id when the client sends none', async () => {
    const response = await request(app.getHttpServer())
      .get('/probe')
      .expect(200);

    expect(response.headers[CORRELATION_ID_HEADER]).toMatch(UUID);
    expect(response.body.correlationId).toBe(
      response.headers[CORRELATION_ID_HEADER],
    );
  });

  it('adds the id to an error body and keeps the safe message', async () => {
    const response = await request(app.getHttpServer())
      .get('/boom')
      .set(CORRELATION_ID_HEADER, 'trace-err')
      .expect(403);

    expect(response.headers[CORRELATION_ID_HEADER]).toBe('trace-err');
    expect(response.body).toMatchObject({
      statusCode: 403,
      message: 'not allowed',
      requestId: 'trace-err',
    });
  });
});
