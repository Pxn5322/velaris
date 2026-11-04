import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Shared HTTP application configuration (browser CORS).
 *
 * The portal in apps/web runs on its own origin and calls this API with a
 * Bearer header, so every request first sends a CORS preflight. Express
 * answers preflights only when an origin allowlist is configured; without
 * it the browser blocks the response (net::ERR_FAILED) even though the
 * API itself is healthy. The mocked CI journeys cannot see this, which is
 * why it was found by the live browser sign-in check (run log 2026-10-29).
 *
 * The allowlist is explicit (never a wildcard, SECURITY.md section 7) and
 * defaults to the two local development origins; deployments set
 * CORS_ORIGIN (comma-separated) to the real web origin - documented in
 * docs/SETUP_GUIDE.md. Bearer headers are allowed; cookies are not used.
 *
 * main.ts and the e2e boot spec both call this function, so the tested
 * behavior is the production behavior.
 */
export function configureApp(app: INestApplication): void {
  // Webhook signatures cover the exact bytes the sender signed (T5.05), so the
  // JSON parser keeps them on the request. The 2 MB parser ceiling stays above
  // the 1 MB webhook limit in the controller, so an oversized body is refused
  // by a guarded route with 413 instead of an unparsed parser error.
  // `verify` reaches body-parser unchanged; the Nest option type omits it, so
  // the cast documents that gap instead of dropping the hook.
  type BodyParserOptions = Parameters<
    NestExpressApplication['useBodyParser']
  >[1];
  (app as NestExpressApplication).useBodyParser('json', {
    limit: '2mb',
    verify: (
      request: IncomingMessage,
      _response: ServerResponse,
      buffer: Buffer,
    ) => {
      (request as IncomingMessage & { rawBody?: Buffer }).rawBody =
        Buffer.from(buffer);
    },
  } as unknown as BodyParserOptions);

  const raw = process.env.CORS_ORIGIN;
  const origins = (
    raw ? raw.split(',') : ['http://localhost:3000', 'http://localhost:3001']
  )
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
}
