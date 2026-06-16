import { NextRequest, NextResponse } from "next/server";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const DASHBOARD_API_TOKEN = process.env.DASHBOARD_API_TOKEN;

function backendUrl(request: NextRequest, path: string[]) {
  const url = new URL(request.url);
  const target = new URL(path.join("/"), `${API_INTERNAL_URL.replace(/\/$/, "")}/`);
  target.search = url.search;
  return target;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const headers = new Headers(request.headers);

  headers.delete("host");
  headers.delete("content-length");

  if (DASHBOARD_API_TOKEN) {
    headers.set("x-decisioncapture-dashboard-token", DASHBOARD_API_TOKEN);
  }

  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  const response = await fetch(backendUrl(request, path), {
    method: request.method,
    headers,
    body,
    cache: "no-store"
  });

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json"
    }
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
