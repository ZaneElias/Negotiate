import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "CallPilot — Voice agents that call, compare, and haggle",
  description: "CallPilot gathers real prices by phone, compares them, and negotiates the best deal on your behalf.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Defaults to dark (the cinematic look); ThemeToggle restores a persisted
  // preference on mount and lets the user switch.
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
