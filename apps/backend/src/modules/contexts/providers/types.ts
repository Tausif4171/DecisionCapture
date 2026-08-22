import type {
  ContextProvider,
  ExternalContextType
} from "@decisioncapture/shared";

export type ResolveUrlOptions = {
  type?: ExternalContextType;
};

export type ContextProviderResolution = {
  provider: ContextProvider;
  type: ExternalContextType;
  providerAccountId: string;
  externalId: string;
  url: string;
  normalizedUrl: string;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
};

export interface ContextProviderAdapter {
  provider: ContextProvider;
  resolveUrl(normalizedUrl: string, options?: ResolveUrlOptions): ContextProviderResolution | null;
}
