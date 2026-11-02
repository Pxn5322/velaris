/**
 * F-09 AI runtime (T4.03; AC-F09-1, AC-F09-2, AC-F09-3; D-19).
 *
 * The customer-facing support runtime runs as a LangGraph state graph:
 *
 *   START -> validate -> retrieve -> ground -> generate -> validate-response -> END
 *
 * Each node can end the run early (conditional edges to END), which is how
 * the acceptance criteria map onto outcomes:
 *
 * - AC-F09-1 (grounded answer): authorized, sufficiently similar knowledge
 *   reaches `generate`; the result carries citations computed SERVER-SIDE
 *   from the retrieved hits, so the model never authors a citation and a
 *   prompt injection cannot fabricate provenance.
 * - AC-F09-2 (abstain/clarify/escalate): empty input -> clarify; no
 *   sufficiently relevant knowledge -> abstain; provider outage after the
 *   bounded retry, an unusable model reply, a denied retrieval or an
 *   explicit human request -> escalate. Every non-respond outcome carries
 *   an escalation context (query, reason, retrieved excerpts) and never
 *   throws at the caller.
 * - AC-F09-3 (no bypass): the caller's tenantId and server-resolved role
 *   pass through to `KnowledgeRetrievalService.search` unchanged, so the
 *   guard chain and tenant scope decide — a denied role never reaches the
 *   LLM.
 *
 * SECURITY.md section 6: external calls need timeouts and bounded retries.
 * The LLM port stays retry-free (T4.01); this runtime owns the bounded
 * retry (MAX_ATTEMPTS) around it. Retrieval failures other than an
 * authorization denial still propagate as errors — a database outage is an
 * operational fault, not an authorization outcome.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  KnowledgeRetrievalService,
  type RetrievalHit,
} from '../knowledge/knowledge-retrieval.service.js';
import {
  LLM_PROVIDER,
  type LlmMessage,
  type LlmProvider,
} from '../../infrastructure/llm/llm.provider.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';

/** Injection token for the grounding similarity threshold. */
export const GROUNDING_THRESHOLD = 'GROUNDING_THRESHOLD';

/** Score >= threshold counts as grounded. Matches the AiAgent default. */
export const DEFAULT_GROUNDING_THRESHOLD = 0.75;

/** Bounded retry around the LLM port (SECURITY.md section 6). */
const MAX_ATTEMPTS = 2;

/** Escalation excerpts stay small: the handoff needs context, not a dump. */
const MAX_EXCERPTS = 5;

export interface AiRuntimeRequest {
  /** Tenant scope required for every query (NFR-01). */
  tenantId: string;
  /** Server-resolved role; null means unresolved and retrieval denies. */
  role: CanonicalRole | null;
  message: string;
  /** Explicit human-handoff request: skip retrieval and the model. */
  requestHuman?: boolean;
}

export type AiOutcome = 'respond' | 'abstain' | 'clarify' | 'escalate';

export type AiReason =
  | 'grounded'
  | 'no_relevant_knowledge'
  | 'empty_input'
  | 'human_request'
  | 'retrieval_denied'
  | 'provider_unavailable'
  | 'invalid_response';

/** Server-computed citation; the model never authors these (AC-F09-1). */
export interface AiCitation {
  chunkId: string;
  chunkIndex: number;
  sourceId: string;
  sourceType: string;
  provenance: unknown;
  model: string;
  score: number;
}

/** Context handed to the human receiving the escalation (AC-F09-2). */
export interface AiEscalation {
  query: string;
  reason: AiReason;
  retrievedCount: number;
  excerpts: string[];
}

export interface AiRuntimeResult {
  outcome: AiOutcome;
  reason: AiReason;
  /** Reply text; null on every non-respond outcome. */
  text: string | null;
  /** Model identifier recorded on traces; null when no completion ran. */
  model: string | null;
  citations: AiCitation[];
  /** LLM attempts made (0 when the model was never called). */
  attempts: number;
  /** Handoff context; null on respond. */
  escalation: AiEscalation | null;
}

/**
 * Validate -> retrieve -> ground -> generate -> validate-response.
 * Every channel carries a reducer plus a default so a node that stops the
 * run early still materializes a complete, readable state snapshot.
 */
const AiState = Annotation.Root({
  request: Annotation<AiRuntimeRequest>(),
  hits: Annotation<RetrievalHit[]>({
    reducer: (_c, u) => u,
    default: () => [],
  }),
  grounded: Annotation<RetrievalHit[]>({
    reducer: (_c, u) => u,
    default: () => [],
  }),
  outcome: Annotation<AiOutcome | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  reason: Annotation<AiReason | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  text: Annotation<string | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  model: Annotation<string | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  citations: Annotation<AiCitation[]>({
    reducer: (_c, u) => u,
    default: () => [],
  }),
  attempts: Annotation<number>({ reducer: (_c, u) => u, default: () => 0 }),
  escalation: Annotation<AiEscalation | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
});

type State = typeof AiState.State;
type Update = typeof AiState.Update;

/**
 * Map the final graph state onto the public result. Every terminal path
 * through the graph sets outcome and reason; the null fallbacks are the
 * defensive contract — a state that somehow ends without an outcome
 * answers `escalate`, never undefined (tested directly in the spec).
 */
export function toResult(state: {
  outcome: AiOutcome | null;
  reason: AiReason | null;
  text: string | null;
  model: string | null;
  citations: AiCitation[];
  attempts: number;
  escalation: AiEscalation | null;
}): AiRuntimeResult {
  return {
    outcome: state.outcome ?? 'escalate',
    reason: state.reason ?? 'provider_unavailable',
    text: state.text,
    model: state.model,
    citations: state.citations,
    attempts: state.attempts,
    escalation: state.escalation,
  };
}

@Injectable()
export class AiRuntimeService {
  private readonly threshold: number;
  private readonly graph: ReturnType<
    ReturnType<
      ReturnType<StateGraph<typeof AiState.spec>['addNode']>['addNode']
    >['compile']
  >;

  constructor(
    private readonly retrieval: KnowledgeRetrievalService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Optional() @Inject(GROUNDING_THRESHOLD) threshold?: number,
  ) {
    this.threshold = threshold ?? DEFAULT_GROUNDING_THRESHOLD;
    this.graph = this.buildGraph();
  }

  /** Run the F-09 graph for one customer message. */
  async handle(request: AiRuntimeRequest): Promise<AiRuntimeResult> {
    if (
      typeof request.tenantId !== 'string' ||
      request.tenantId.trim() === ''
    ) {
      throw new BadRequestException('tenantId is required');
    }
    const state = await this.graph.invoke({ request });
    return toResult(state);
  }

  private buildGraph() {
    const escalationFor = (state: State, reason: AiReason): AiEscalation => ({
      query: state.request.message,
      reason,
      retrievedCount: state.hits.length,
      excerpts: state.hits.map((hit) => hit.content).slice(0, MAX_EXCERPTS),
    });

    const validate = (state: State): Update => {
      if (state.request.message.trim().length === 0) {
        return {
          outcome: 'clarify',
          reason: 'empty_input',
          escalation: escalationFor(state, 'empty_input'),
        };
      }
      return {};
    };

    const retrieve = async (state: State): Promise<Update> => {
      if (state.request.requestHuman === true) {
        return {
          outcome: 'escalate',
          reason: 'human_request',
          escalation: escalationFor(state, 'human_request'),
        };
      }
      try {
        const hits = await this.retrieval.search({
          tenantId: state.request.tenantId,
          role: state.request.role,
          query: state.request.message,
        });
        return { hits };
      } catch (error) {
        if (error instanceof ForbiddenException) {
          // AC-F09-3: a denied principal learns nothing and never sees the model.
          return {
            outcome: 'escalate',
            reason: 'retrieval_denied',
            escalation: escalationFor(state, 'retrieval_denied'),
          };
        }
        throw error;
      }
    };

    const ground = (state: State): Update => {
      const grounded = state.hits.filter((hit) => hit.score >= this.threshold);
      if (grounded.length === 0) {
        return {
          outcome: 'abstain',
          reason: 'no_relevant_knowledge',
          escalation: escalationFor(state, 'no_relevant_knowledge'),
        };
      }
      return { grounded };
    };

    const generate = async (state: State): Promise<Update> => {
      const context = state.grounded
        .map((hit, index) => `[${index + 1}] ${hit.content}`)
        .join('\n');
      const messages: LlmMessage[] = [
        {
          role: 'system',
          content:
            'Answer only from the context below. ' +
            'If the context lacks the answer, say you do not know.\n\n' +
            `Context:\n${context}`,
        },
        { role: 'user', content: state.request.message },
      ];

      let attempts = 0;
      while (attempts < MAX_ATTEMPTS) {
        attempts += 1;
        try {
          const completion = await this.llm.complete({ messages });
          return {
            text: completion.text,
            model: completion.model,
            attempts,
          };
        } catch {
          // Bounded retry (SECURITY.md section 6); the next loop
          // iteration is the last attempt.
        }
      }
      return {
        outcome: 'escalate',
        reason: 'provider_unavailable',
        attempts,
        escalation: escalationFor(state, 'provider_unavailable'),
      };
    };

    const validateResponse = (state: State): Update => {
      if (state.text === null || state.text.trim().length === 0) {
        return {
          text: null,
          outcome: 'escalate',
          reason: 'invalid_response',
          escalation: escalationFor(state, 'invalid_response'),
        };
      }
      // Citations come from the grounded hits, never from model output.
      const citations: AiCitation[] = state.grounded.map((hit) => ({
        chunkId: hit.chunkId,
        chunkIndex: hit.chunkIndex,
        sourceId: hit.citation.sourceId,
        sourceType: hit.citation.sourceType,
        provenance: hit.citation.provenance,
        model: hit.citation.model,
        score: hit.score,
      }));
      return {
        outcome: 'respond',
        reason: 'grounded',
        citations,
        escalation: null,
      };
    };

    return new StateGraph(AiState)
      .addNode('validate', validate)
      .addNode('retrieve', retrieve)
      .addNode('ground', ground)
      .addNode('generate', generate)
      .addNode('validateResponse', validateResponse)
      .addEdge(START, 'validate')
      .addConditionalEdges('validate', (state: State) =>
        state.outcome ? END : 'retrieve',
      )
      .addConditionalEdges('retrieve', (state: State) =>
        state.outcome ? END : 'ground',
      )
      .addConditionalEdges('ground', (state: State) =>
        state.outcome ? END : 'generate',
      )
      .addConditionalEdges('generate', (state: State) =>
        state.outcome ? END : 'validateResponse',
      )
      .addEdge('validateResponse', END)
      .compile();
  }
}
