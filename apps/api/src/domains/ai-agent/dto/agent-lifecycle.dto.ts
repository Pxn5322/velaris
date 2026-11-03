/**
 * Request bodies for the agent lifecycle routes (T4.06, API-10..API-12).
 *
 * No class-validator decorators exist in this repository, so field
 * presence, type and range checks live in AiAgentService and run before
 * any write. `tenantId` is never part of a body: it is a query parameter
 * and the caller must hold an ACTIVE membership in that tenant.
 */

/** Draft configuration snapshot stored in `ai_agent_versions.config_json`. */
export interface AgentConfig {
  systemPrompt: string;
  model: string;
  temperature?: number;
  /** Registered tool names granted to this version, resolved by name. */
  tools?: string[];
}

export class CreateAgentDto {
  name!: string;
  description?: string;
  config!: AgentConfig;
}

export class CreateAgentVersionDto {
  config!: AgentConfig;
}

export class RunAgentEvaluationDto {
  datasetVersion!: string;
  provider!: string;
  model!: string;
}

export class RollbackAgentDto {
  versionId!: string;
}
