export class InvalidExternalUrlError extends Error {
  constructor(message = "External context URL must be an absolute HTTP or HTTPS URL") {
    super(message);
  }
}

function isDefaultPort(url: URL) {
  return (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  );
}

export function normalizeExternalUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new InvalidExternalUrlError();
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidExternalUrlError();
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (isDefaultPort(url)) {
    url.port = "";
  }

  const sortedParams = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyComparison = leftKey.localeCompare(rightKey);
    return keyComparison === 0 ? leftValue.localeCompare(rightValue) : keyComparison;
  });

  url.search = "";
  sortedParams.forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  return url.toString();
}
