import { z } from "zod";

export const conflictReviewSchema = z.object({
  action: z.enum(["dismiss", "resolve"]),
  note: z.string().trim().max(1_000).optional()
});

export const conflictAssessmentSchema = z.object({
  decisionId: z.string().min(1),
  conflict: z.boolean(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().trim().min(20).max(800),
  evidenceFromPr: z.array(z.string().trim().min(3).max(400)).min(1).max(5),
  evidenceFromDecision: z.array(z.string().trim().min(3).max(400)).min(1).max(5)
});

export const conflictAssessmentResponseSchema = z.object({
  assessments: z.array(conflictAssessmentSchema).max(25)
});
