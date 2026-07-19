"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

function readStored(): "light" | "dark" {
  try {
    const s = localStorage.getItem("cp-theme");
    if (s === "light" || s === "dark") return s;
  } catch {
    /* storage disabled */
  }
  return "dark";
}

/**
 * Header theme toggle. The actual theme is applied pre-paint by the inline
 * script in layout.tsx (reads localStorage, defaults to dark); this button
 * just flips <html data-theme> and persists the choice. localStorage holds a
 * non-sensitive UI preference only — no tokens or personal data.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document === "undefined" ? "dark" : readStored()
  );

  // Sync the persisted preference to <html> on mount. DOM-only (no setState),
  // so it doesn't trip the set-state-in-effect rule; at worst a one-frame
  // flash from the dark default for a returning light-mode user.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("cp-theme", next);
    } catch {
      /* private mode / storage disabled — preference just isn't persisted */
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      suppressHydrationWarning
      className={cn(
        "flex size-8 items-center justify-center rounded-full border border-line bg-paper-raised text-ink-muted cp-transition",
        "hover:border-action/50 hover:text-ink"
      )}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
