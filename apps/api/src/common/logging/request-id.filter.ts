/**
 * Error correlation filter (T5.01; AC-F13-1, ARCHITECTURE section 4).
 *
 * The contract is `{ code, message, details?, requestId }`. Nest's default
 * body carries status, message and error, so this filter keeps those fields
 * (existing clients and tests rely on them) and adds the correlation id. A
 * non-HTTP fault becomes a safe 500 with the same shape, and the stack stays
 * in the server log, never in the response (SECURITY.md section 7).
 */

import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { currentCorrelationId } from './correlation.js';

@Catch()
export class RequestIdFilter implements ExceptionFilter {
  private readonly logger = new Logger(RequestIdFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    let body: Record<string, unknown>;
    if (exception instanceof HttpException) {
      const raw = exception.getResponse();
      body =
        typeof raw === 'object' && raw !== null
          ? { ...(raw as Record<string, unknown>) }
          : { statusCode: status, message: String(raw) };
    } else {
      this.logger.error(
        exception instanceof Error ? exception.stack : 'Unknown error',
      );
      body = { statusCode: status, message: 'Internal server error' };
    }

    const correlationId = currentCorrelationId();
    response
      .status(status)
      .json(correlationId ? { ...body, requestId: correlationId } : body);
  }
}
