import type { DecisionRelationshipType } from "@decisioncapture/shared";
import { z } from "zod";
import { env } from "../../config/env.js";

export const relationshipReviewSchema = z.object({
  note: z.string().trim().min(3).max(500).optional()
});

export function minimumRelationshipConfidence(type: DecisionRelationshipType) {
  if (type === "SUPERSEDES") {
    return Math.max(env.RELATIONSHIP_CONFIDENCE_THRESHOLD, 0.8);
  }

  if (type === "POSSIBLE_CONFLICT") {
    return Math.max(env.RELATIONSHIP_CONFIDENCE_THRESHOLD, 0.75);
  }

  return env.RELATIONSHIP_CONFIDENCE_THRESHOLD;
}
