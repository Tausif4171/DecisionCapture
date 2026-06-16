import { NextRequest, NextResponse } from "next/server";

const authEnabled = process.env.DASHBOARD_AUTH_ENABLED === "true";
const username = process.env.DASHBOARD_USERNAME;
const password = process.env.DASHBOARD_PASSWORD;

function unauthorized(message = "Authentication required") {
  return new NextResponse(message, {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="DecisionCapture"'
    }
  });
}

function credentialsFrom(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  if (!authEnabled) {
    return NextResponse.next();
  }

  if (!username || !password) {
    return new NextResponse("Dashboard authentication is not configured", { status: 503 });
  }

  const credentials = credentialsFrom(request);
  if (credentials?.username === username && credentials.password === password) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
