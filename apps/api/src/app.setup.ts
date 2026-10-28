import type { INestApplication } from '@nestjs/common';

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
