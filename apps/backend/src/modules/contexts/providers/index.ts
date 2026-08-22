import { HttpError } from "../../../middleware/error.js";
import { genericContextProvider } from "./generic.provider.js";
import { githubContextProvider } from "./github.provider.js";
import { jiraContextProvider } from "./jira.provider.js";
import { linearContextProvider } from "./linear.provider.js";
import type {
  ContextProviderAdapter,
  ContextProviderResolution,
  ResolveUrlOptions
} from "./types.js";
import { InvalidExternalUrlError, normalizeExternalUrl } from "./url.js";

const providers: ContextProviderAdapter[] = [
  githubContextProvider,
  linearContextProvider,
  jiraContextProvider
];

export function resolveExternalContextUrl(
  value: string,
  options: ResolveUrlOptions = {}
): ContextProviderResolution {
  let normalizedUrl: string;

  try {
    normalizedUrl = normalizeExternalUrl(value);
  } catch (error) {
    if (error instanceof InvalidExternalUrlError) {
      throw new HttpError(400, error.message);
    }

    throw error;
  }

  const providerResolution = providers
    .map((provider) => provider.resolveUrl(normalizedUrl, options))
    .find((resolution): resolution is ContextProviderResolution => Boolean(resolution));
  const fallbackResolution = genericContextProvider.resolveUrl(normalizedUrl, options);
  const resolution = providerResolution ?? fallbackResolution;

  if (!resolution) {
    throw new HttpError(400, "External context URL could not be resolved");
  }

  if (options.type && resolution.type !== options.type) {
    throw new HttpError(
      400,
      `External URL resolves to ${resolution.type}, not ${options.type}`
    );
  }

  return resolution;
}

export { normalizeExternalUrl };
