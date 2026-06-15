import { z } from "zod";

export const githubPullRequestWebhookSchema = z.object({
  action: z.string(),
  repository: z.object({
    full_name: z.string()
  }),
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable().optional(),
    merged: z.boolean(),
    merged_at: z.string().nullable().optional(),
    html_url: z.string().url(),
    draft: z.boolean().optional().default(false),
    user: z.object({
      login: z.string()
    }),
    labels: z
      .array(
        z.object({
          name: z.string()
        })
      )
      .optional()
      .default([])
  })
});
