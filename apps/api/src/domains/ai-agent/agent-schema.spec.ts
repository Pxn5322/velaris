/**
 * T4.02 agent schema contract (F-08, F-11; AC-F08-1).
 *
 * These tests pin the agent schema the governed-agent phase depends on:
 *
 * 1. The four tables from DATABASE.md section 6 exist: ai_agents,
 *    ai_agent_versions, agent_tool_grants and evaluation_runs, each
 *    carrying its tenant column so scoping never depends on a join.
 * 2. Versions are unique per agent, and a PUBLISHED version is immutable
 *    in the database itself (a BEFORE UPDATE trigger), because AC-F08-1
 *    makes the published snapshot the audit ground truth — application
 *    discipline alone is not a boundary (SECURITY.md section 7).
 * 3. Tool grants are unique per (version, tool), so a grant cannot be
 *    duplicated to widen a capability (AC-F08-3 depends on exactly one
 *    grant row per capability).
 * 4. Grants and evaluation runs cascade from their version, and versions
 *    cascade from their agent, so tenant cleanup leaves no orphans.
 *
 * Reading the migration file keeps this a pure unit test: no database is
 * needed, so it runs in the normal `npm run test` job.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  AiAgent,
  AiAgentVersion,
  AgentToolGrant,
  EvaluationRun,
} from '@prisma/client';

// Resolve from this file, not the process CWD: vitest runs with cwd set to
// apps/api, while the migration directory lives at the repository root.
const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../../prisma/migrations/0005_agent_schema/migration.sql',
    import.meta.url,
  ),
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('T4.02 agent schema', () => {
  it('exposes status, config and evaluation fields on the generated client', () => {
    // Type-level assertions: these assignments fail to compile if the
    // generated client drops fields the runtime and governance read.
    const agent: Pick<
      AiAgent,
      'status' | 'ownerMembershipId' | 'activeVersionId'
    > = {
      status: 'DRAFT',
      ownerMembershipId: '55555555-5555-4555-8555-555555555507',
      activeVersionId: null,
    };
    const version: Pick<
      AiAgentVersion,
      'version' | 'configJson' | 'publishedAt' | 'status'
    > = {
      version: 1,
      configJson: { instructions: 'be terse' },
      publishedAt: null,
      status: 'DRAFT',
    };
    const grant: Pick<AgentToolGrant, 'toolId' | 'grantedBy'> = {
      toolId: '55555555-5555-4555-8555-555555555508',
      grantedBy: '55555555-5555-4555-8555-555555555509',
    };
    const run: Pick<
      EvaluationRun,
      'datasetVersion' | 'provider' | 'model' | 'status' | 'failureReasonsJson'
    > = {
      datasetVersion: 'ds-v1',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      status: 'PASSED',
      failureReasonsJson: [],
    };

    expect(agent.status).toBe('DRAFT');
    expect(version.status).toBe('DRAFT');
    expect(grant.toolId.length).toBeGreaterThan(0);
    expect(run.status).toBe('PASSED');
  });

  it('creates the four agent tables with explicit tenant columns', () => {
    const sql = migrationSql();

    for (const table of [
      'ai_agents',
      'ai_agent_versions',
      'agent_tool_grants',
      'evaluation_runs',
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
      expect(sql).toMatch(
        new RegExp(
          `CREATE TABLE "${table}"[\\s\\S]*?"tenant_id" UUID NOT NULL`,
        ),
      );
    }
  });

  it('makes versions unique per agent and immutable once published', () => {
    const sql = migrationSql();

    expect(sql).toContain('ai_agent_versions_agent_id_version_key');
    // AC-F08-1: the published snapshot is the audit ground truth. The
    // database itself rejects updates to a PUBLISHED row; a version may
    // still transition DRAFT -> PUBLISHED (WHEN guards on the old value).
    expect(sql).toMatch(
      /BEFORE UPDATE ON "ai_agent_versions"[\s\S]*?WHEN \(OLD\."status" = 'PUBLISHED'\)/,
    );
    expect(sql).toMatch(/RAISE EXCEPTION[^\n]*immutable/i);
    expect(sql).toMatch(
      /CREATE TRIGGER "ai_agent_versions_published_immutable"/,
    );
  });

  it('makes tool grants unique per version and tool', () => {
    const sql = migrationSql();

    expect(sql).toContain('agent_tool_grants_agent_version_id_tool_id_key');
  });

  it('indexes agents by tenant and name', () => {
    expect(migrationSql()).toContain('ai_agents_tenant_id_name_idx');
  });

  it('cascades grants and evaluation runs from their version', () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /FOREIGN KEY \("agent_version_id"\) REFERENCES "ai_agent_versions"\("id"\) ON DELETE CASCADE/,
    );
    // Both child tables carry that foreign key; count them.
    const matches = sql.match(
      /FOREIGN KEY \("agent_version_id"\) REFERENCES "ai_agent_versions"\("id"\) ON DELETE CASCADE/g,
    );
    expect(matches ?? []).toHaveLength(2);
  });

  it('cascades versions from their agent', () => {
    expect(migrationSql()).toMatch(
      /FOREIGN KEY \("agent_id"\) REFERENCES "ai_agents"\("id"\) ON DELETE CASCADE/,
    );
  });
});
