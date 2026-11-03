/**
 * In-process tool handler registry (T4.04, F-10).
 *
 * Definitions are data (`ai_tool_definitions` rows); handlers are code. A
 * tool can only run when both exist and agree on the name, so a database
 * row cannot conjure behavior that was never deployed, and a deployed
 * handler cannot run without a definition, grant and permission
 * (SECURITY.md section 3: the allow-list is server-side).
 *
 * The registry starts empty. Later tasks register conversation, ticket and
 * knowledge actions here.
 */

import { Injectable } from '@nestjs/common';
import type { ToolHandler } from './tool.types.js';

@Injectable()
export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  /** Register a handler; re-registering a name replaces it (tests, hot reload). */
  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }

  get(name: string): ToolHandler | null {
    return this.handlers.get(name) ?? null;
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  names(): string[] {
    return [...this.handlers.keys()];
  }
}
