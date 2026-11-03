/**
 * Correlation middleware (T5.01; AC-F13-1).
 *
 * Resolves the identifier before any guard runs, so a denial recorded by the
 * audit path already carries it, and echoes it on the response so a caller
 * can quote one value in a support request.
 */

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
  runWithCorrelationId,
} from './correlation.js';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const correlationId = resolveCorrelationId(
      request.headers[CORRELATION_ID_HEADER],
    );
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    runWithCorrelationId(correlationId, () => next());
  }
}
