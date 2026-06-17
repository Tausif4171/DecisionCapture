import type { DecisionScore, ExtractedDecision, PRContext } from "@decisioncapture/shared";

export interface AIProvider {
  extractDecision(context: PRContext, score: DecisionScore): Promise<ExtractedDecision>;
}
