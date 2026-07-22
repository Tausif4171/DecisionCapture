"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DatabaseZap, GitPullRequestArrow, SearchCheck } from "lucide-react";
import { AuthStatusControl } from "./auth-status";

const navItems = [
  { href: "/", label: "Dashboard", icon: DatabaseZap },
  { href: "/decisions", label: "Decisions", icon: SearchCheck },
  { href: "/pending", label: "Review queue", icon: GitPullRequestArrow }
];

function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-neutral-950 text-white shadow-sm">
            <DatabaseZap className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-neutral-950">DecisionCapture</span>
            <span className="block text-xs text-neutral-500">Engineering memory for merged PRs</span>
          </span>
        </Link>
        <div className="flex flex-wrap gap-2">
          <nav className="flex flex-wrap gap-2" aria-label="Primary navigation">
            {navItems.map((item) => {
              const active = isActivePath(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium shadow-sm transition ${
                    active
                      ? "border-neutral-950 bg-neutral-950 text-white"
                      : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
                  }`}
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <AuthStatusControl />
        </div>
      </div>
    </header>
  );
}
