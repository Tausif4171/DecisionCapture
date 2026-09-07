import type {
  DecisionRelationshipAnalysisResponse,
  DecisionRelationshipType
} from "@decisioncapture/shared";
import type { ReviewActor } from "../auth/types.js";

export const RELATIONSHIP_ANALYSIS_VERSION = "v3.1";

export type RelationshipDecisionInput = {
  id: string;
  decision: string;
  reason: string;
  alternative?: string | null;
  impact: string;
  category: string;
  repository: string;
  sourcePR: string;
  filesChanged: string[];
  contextLabels: string[];
  createdAt: string;
};

export type RelationshipCandidate = RelationshipDecisionInput & {
  relevance: number;
  relevanceSignals: string[];
};

export type RelationshipAssessment = {
  targetDecisionId: string;
  type: DecisionRelationshipType;
  confidence: number;
  explanation: string;
  evidence: string[];
};

export interface RelationshipReasoningProvider {
  analyze(
    source: RelationshipDecisionInput,
    candidates: RelationshipCandidate[]
  ): Promise<RelationshipAssessment[]>;
}

export type RelationshipAnalysisRequest = {
  decisionId: string;
  actor?: ReviewActor;
};

export type RelationshipQueueResult = DecisionRelationshipAnalysisResponse;
