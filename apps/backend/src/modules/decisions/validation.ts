import { z } from "zod";

const stringArraySchema = z
  .array(z.union([z.string(), z.null()]))
  .optional()
  .default([])
  .transform((values) =>
    values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  );

export const prContextSchema = z.object({
  prNumber: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().optional().default(""),
  mergedAt: z.string().optional(),
  author: z.string().min(1),
  url: z.string().url(),
  repository: z.string().min(1),
  filesChanged: stringArraySchema,
  commits: stringArraySchema,
  reviewers: stringArraySchema,
  reviewComments: stringArraySchema,
  approvals: stringArraySchema,
  labels: stringArraySchema,
  diffSummary: z.string().optional().default("")
});

export const decisionSearchSchema = z.object({
  q: z.string().optional(),
  status: z.enum(["APPROVED", "PENDING", "REJECTED"]).optional(),
  repository: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(["recent", "confidence", "oldest"]).optional().default("recent"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30)
});

export const decisionReviewSchema = z.object({
  decision: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  alternative: z.string().optional().nullable(),
  impact: z.string().min(1).optional()
});
