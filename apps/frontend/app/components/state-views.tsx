"use client";

import { AlertCircle, ArrowRight, Github, Inbox, Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { authLoginUrl } from "../../lib/api";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-white">
      <div className="flex items-center gap-3 text-sm font-medium text-neutral-600">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}

export function isAuthRequiredMessage(message: string) {
  return message.toLowerCase().includes("github sign-in is required");
}

export function ErrorState({ message }: { message: string }) {
  const pathname = usePathname();
  const isAuthRequired = isAuthRequiredMessage(message);

  if (isAuthRequired) {
    return (
      <div className="flex justify-center pt-8 sm:pt-12">
        <div className="w-full max-w-md rounded-md border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-neutral-950">Access engineering memory</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Use GitHub to view decisions captured from merged pull requests.
          </p>
          <div className="mt-5">
            <a
              href={authLoginUrl(pathname)}
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-neutral-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"
            >
              <Github className="size-4" aria-hidden="true" />
              Continue with GitHub
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-48 items-center justify-center rounded-md border border-red-200 bg-white px-4 text-center shadow-sm">
      <div className="max-w-md">
        <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-red-50 text-red-600">
          <AlertCircle className="size-5" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold text-red-900">Unable to load data</p>
        <p className="mt-1 text-sm text-red-700">{message}</p>
      </div>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-white px-4 text-center">
      <div className="max-w-md">
        <Inbox className="mx-auto mb-3 size-5 text-neutral-400" aria-hidden="true" />
        <p className="text-sm font-semibold text-neutral-950">{title}</p>
        <p className="mt-1 text-sm text-neutral-500">{description}</p>
      </div>
    </div>
  );
}
