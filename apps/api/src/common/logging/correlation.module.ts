/**
 * Correlation wiring (T5.01).
 *
 * Imported once by AppModule. The middleware runs on every route before the
 * guard chain; the filter makes the identifier visible in every error body.
 * Both are global, so a new controller inherits propagation without changes.
 */

import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { RequestContextMiddleware } from './request-context.middleware.js';
import { RequestIdFilter } from './request-id.filter.js';

@Module({
  providers: [{ provide: APP_FILTER, useClass: RequestIdFilter }],
})
export class CorrelationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Nest 12 uses Express 5 path syntax: `{*splat}` matches every route,
    // including `/` and nested API paths.
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
