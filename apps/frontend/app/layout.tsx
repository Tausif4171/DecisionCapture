import type { Metadata } from "next";
import { AppHeader } from "./components/app-header";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "DecisionCapture",
  description: "Engineering decision memory captured from merged pull requests"
};

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
            <AppHeader />
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
