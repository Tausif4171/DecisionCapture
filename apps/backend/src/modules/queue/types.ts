import type { AnalyzeResponse, PRContext } from "@decisioncapture/shared";

export const DECISION_ANALYSIS_JOB_NAME = "analyze-pr";

export type DecisionQueuePayload = PRContext;
export type DecisionQueueResult = AnalyzeResponse;
