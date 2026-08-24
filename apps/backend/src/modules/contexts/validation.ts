import { z } from "zod";

export const externalContextTypeSchema = z.enum([
  "ISSUE",
  "ADR",
  "ARCHITECTURE_DOC",
  "MEETING"
]);

export const decisionContextRelationshipTypeSchema = z.enum([
  "RELATED",
  "ORIGINATED_FROM",
  "DOCUMENTS",
  "DISCUSSED_IN"
]);

export const resolveContextUrlSchema = z.object({
  url: z.string().trim().url().max(2048),
  type: externalContextTypeSchema.optional()
});

export const listGitHubIssuesSchema = z.object({
  repository: z.string().trim().regex(/^[^/\s]+\/[^/\s]+$/, "Repository must use owner/repository"),
  query: z.string().trim().max(200).optional().default("")
});

export const createDecisionContextLinkSchema = z
  .object({
    url: z.string().trim().url().max(2048).optional(),
    externalContextId: z.string().trim().min(1).optional(),
    relationshipType: decisionContextRelationshipTypeSchema.optional().default("RELATED"),
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(2000).optional(),
    type: externalContextTypeSchema.optional()
  })
  .superRefine((value, context) => {
    const hasUrl = Boolean(value.url);
    const hasExternalContextId = Boolean(value.externalContextId);

    if (hasUrl === hasExternalContextId) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Provide exactly one of url or externalContextId"
      });
    }

    if (hasExternalContextId && (value.title || value.description || value.type)) {
      context.addIssue({
        code: "custom",
        path: ["externalContextId"],
        message: "Existing context links cannot override context metadata"
      });
    }
  });
