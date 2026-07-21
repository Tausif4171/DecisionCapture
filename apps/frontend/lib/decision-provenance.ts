import type { DecisionExtractionMethod } from "@decisioncapture/shared";

export function formatExtractionConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}% extraction confidence`;
}

export function formatExtractionMethod(method: DecisionExtractionMethod) {
  if (method === "OLLAMA") {
    return "Extraction method: Ollama";
  }

  if (method === "STRUCTURED_FALLBACK") {
    return "Extraction method: Structured fallback";
  }

  return "Extraction method: Unavailable";
}
