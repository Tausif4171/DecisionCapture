import type { ContextProviderAdapter } from "./types.js";

export const genericContextProvider: ContextProviderAdapter = {
  provider: "GENERIC",
  resolveUrl(normalizedUrl, options) {
    const url = new URL(normalizedUrl);

    return {
      provider: "GENERIC",
      type: options?.type ?? "ARCHITECTURE_DOC",
      providerAccountId: url.hostname,
      externalId: normalizedUrl,
      url: normalizedUrl,
      normalizedUrl,
      title: url.hostname,
      metadata: {
        hostname: url.hostname
      }
    };
  }
};
