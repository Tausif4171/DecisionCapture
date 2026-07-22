"use client";

import { useEffect, useId } from "react";
import { Loader2, X } from "lucide-react";

type ReviewReasonDialogProps = {
  open: boolean;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  value: string;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  isPending: boolean;
  error?: Error | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

export function ReviewReasonDialog({
  open,
  title,
  description,
  label,
  placeholder,
  value,
  confirmLabel,
  pendingLabel,
  destructive = false,
  isPending,
  error,
  onChange,
  onClose,
  onConfirm
}: ReviewReasonDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const trimmedLength = value.trim().length;
  const isValid = trimmedLength >= MIN_REASON_LENGTH && value.length <= MAX_REASON_LENGTH;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isPending, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-md bg-white p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (isValid && !isPending) {
            onConfirm();
          }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-neutral-950">
              {title}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm leading-6 text-neutral-600">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 disabled:text-neutral-300"
            title="Close"
            aria-label="Close dialog"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-semibold uppercase tracking-normal text-neutral-500">{label}</span>
          <textarea
            autoFocus
            value={value}
            maxLength={MAX_REASON_LENGTH}
            onChange={(event) => onChange(event.target.value)}
            className="mt-1 min-h-28 w-full rounded-md border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
            placeholder={placeholder}
          />
        </label>
        <div className="mt-1 flex items-center justify-between gap-3 text-xs text-neutral-500">
          <span>10-500 characters</span>
          <span>{value.length}/500</span>
        </div>
        {error ? (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {error.message}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="min-h-10 rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:text-neutral-400"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid || isPending}
            className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:bg-neutral-300 ${
              destructive ? "bg-red-600 hover:bg-red-700" : "bg-neutral-950 hover:bg-neutral-800"
            }`}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {isPending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
