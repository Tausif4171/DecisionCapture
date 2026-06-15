import { env } from "../../config/env.js";
import { HeuristicAIProvider } from "./heuristic.provider.js";
import { OllamaAIProvider } from "./ollama.provider.js";
import type { AIProvider } from "./provider.js";

export function createAIProvider(): AIProvider {
  const heuristic = new HeuristicAIProvider();

  if (env.AI_PROVIDER === "heuristic") {
    return heuristic;
  }

  return new OllamaAIProvider(heuristic);
}
