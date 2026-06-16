import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  maxRequests: number;
  windowMs: number;
};

type Counter = {
  count: number;
  resetAt: number;
};

const counters = new Map<string, Counter>();

function clientKey(request: Request) {
  const forwardedFor = request.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.ip || request.socket.remoteAddress || "unknown";
}

function cleanup(now: number) {
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) {
      counters.delete(key);
    }
  }
}

export function createRateLimiter({ maxRequests, windowMs }: RateLimitOptions) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.path === "/health") {
      return next();
    }

    const now = Date.now();
    cleanup(now);

    const key = clientKey(request);
    const existing = counters.get(key);
    const counter = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };

    counter.count += 1;
    counters.set(key, counter);

    response.setHeader("RateLimit-Limit", String(maxRequests));
    response.setHeader("RateLimit-Remaining", String(Math.max(0, maxRequests - counter.count)));
    response.setHeader("RateLimit-Reset", String(Math.ceil(counter.resetAt / 1000)));

    if (counter.count > maxRequests) {
      return response.status(429).json({
        error: "Too Many Requests",
        message: "Rate limit exceeded"
      });
    }

    return next();
  };
}
