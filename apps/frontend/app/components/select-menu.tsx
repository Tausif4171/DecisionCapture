"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectMenuOption = {
  value: string;
  label: string;
};

type SelectMenuProps = {
  label: string;
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
};

export function SelectMenu({ label, value, options, onChange }: SelectMenuProps) {
  const labelId = useId();
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0]!;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function selectRelativeOption(direction: 1 | -1) {
    const currentIndex = Math.max(
      0,
      options.findIndex((option) => option.value === selectedOption.value)
    );
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    onChange(options[nextIndex]!.value);
  }

  return (
    <div ref={containerRef} className="relative">
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby={labelId}
        aria-controls={isOpen ? menuId : undefined}
        className="inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-700 shadow-sm outline-none transition hover:border-neutral-300 hover:bg-neutral-50 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            selectRelativeOption(1);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setIsOpen(true);
            selectRelativeOption(-1);
          }
        }}
      >
        <span className="truncate">{selectedOption.label}</span>
        <ChevronDown
          className={`size-4 shrink-0 text-neutral-400 transition ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div
          id={menuId}
          role="listbox"
          aria-labelledby={labelId}
          className="absolute left-0 top-[calc(100%+0.375rem)] z-30 w-full min-w-44 overflow-hidden rounded-md border border-neutral-200 bg-white p-1 shadow-lg"
        >
          {options.map((option) => {
            const selected = option.value === selectedOption.value;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`flex min-h-9 w-full items-center justify-between gap-3 rounded px-2.5 text-left text-sm transition ${
                  selected
                    ? "bg-emerald-50 font-semibold text-emerald-800"
                    : "text-neutral-700 hover:bg-neutral-100"
                }`}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                <span className="truncate">{option.label}</span>
                {selected ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
