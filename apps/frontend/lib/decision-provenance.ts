import type { DecisionExtractionMethod } from "@decisioncapture/shared";

export function formatExtractionConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}% extraction confidence`;
}

export function formatExtractionMethod(method: DecisionExtractionMethod) {
  if (method === "OLLAMA") {
    return "Initially captured by Ollama";
  }

  if (method === "STRUCTURED_FALLBACK") {
    return "Initially captured via structured fallback";
  }

  return "Initial capture method unavailable";
}
