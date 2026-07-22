import Link from "next/link";
import { ArrowLeft, Github, ShieldAlert } from "lucide-react";
import { authLoginUrl } from "../../../lib/api";

type AuthErrorReason = "account-not-allowed" | "invalid-state" | "oauth-failed";

type AuthErrorPageProps = {
  searchParams: Promise<{
    reason?: string | string[];
    returnTo?: string | string[];
  }>;
};

const errorCopy: Record<AuthErrorReason, { title: string; description: string; note: string }> = {
  "account-not-allowed": {
    title: "GitHub account not allowed",
    description:
      "This deployment does not allow this GitHub account. Use an account with access or ask the project owner.",
    note: "If GitHub keeps selecting the wrong account, sign out of GitHub first and try again."
  },
  "invalid-state": {
    title: "Sign-in session expired",
    description: "The GitHub sign-in request could not be verified. Start the sign-in flow again to continue.",
    note: "This usually happens when the callback link is old, reused, or opened after too much time."
  },
  "oauth-failed": {
    title: "GitHub sign-in did not complete",
    description: "GitHub authentication could not be completed. Try signing in again.",
    note: "If the issue continues, contact the project owner."
  }
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseReason(value: string | undefined): AuthErrorReason {
  if (value === "account-not-allowed" || value === "invalid-state" || value === "oauth-failed") {
    return value;
  }

  return "oauth-failed";
}

function safeReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnTo(firstParam(params.returnTo));
  const reason = parseReason(firstParam(params.reason));
  const copy = errorCopy[reason];

  return (
    <section className="flex min-h-[28rem] items-center justify-center">
      <div className="w-full max-w-2xl rounded-md border border-neutral-200 bg-white px-6 py-10 text-center shadow-sm sm:px-10">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-md bg-neutral-950 text-white">
          <ShieldAlert className="size-6" aria-hidden="true" />
        </div>
        <p className="text-lg font-semibold text-neutral-950">{copy.title}</p>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-600">{copy.description}</p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={authLoginUrl(returnTo)}
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"
          >
            <Github className="size-4" aria-hidden="true" />
            Sign in with GitHub
          </a>
          <Link
            href="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
        </div>
        <p className="mx-auto mt-5 max-w-lg text-xs leading-5 text-neutral-500">{copy.note}</p>
      </div>
    </section>
  );
}
