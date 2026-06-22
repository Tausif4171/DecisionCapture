import type { Metadata } from "next";
import Link from "next/link";
import { DatabaseZap, GitPullRequestArrow, SearchCheck } from "lucide-react";
import { AuthStatusControl } from "./components/auth-status";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "DecisionCapture",
  description: "Engineering decision memory captured from merged pull requests"
};

const navItems = [
  { href: "/", label: "Dashboard", icon: DatabaseZap },
  { href: "/decisions", label: "Decisions", icon: SearchCheck },
  { href: "/pending", label: "Pending", icon: GitPullRequestArrow }
];

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen">
            <header className="border-b border-neutral-200 bg-white/85 backdrop-blur">
              <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
                <Link href="/" className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-md bg-neutral-950 text-white">
                    <DatabaseZap className="size-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-neutral-950">DecisionCapture</span>
                    <span className="block text-xs text-neutral-500">Engineering memory for merged PRs</span>
                  </span>
                </Link>
                <div className="flex flex-wrap gap-2">
                  <nav className="flex flex-wrap gap-2">
                    {navItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"
                      >
                        <item.icon className="size-4" aria-hidden="true" />
                        {item.label}
                      </Link>
                    ))}
                  </nav>
                  <AuthStatusControl />
                </div>
              </div>
            </header>
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
