import { AlertCircle, Inbox, Loader2 } from "lucide-react";

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

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 text-center">
      <div className="max-w-md">
        <AlertCircle className="mx-auto mb-3 size-5 text-red-600" aria-hidden="true" />
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
