"use client";

import { PhoneCall, ShieldCheck, AlertTriangle } from "lucide-react";
import { StageProgress } from "@/components/stage-progress";
import { ThemeToggle } from "@/components/theme-toggle";
import type { HealthStatus, Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AppShell({
  stage,
  furthestReached,
  onNavigate,
  health,
  children,
}: {
  stage: Stage;
  furthestReached: Stage;
  onNavigate: (stage: Stage) => void;
  health: HealthStatus | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-md bg-action text-action-foreground">
                <PhoneCall className="size-4" />
              </div>
              <span className="font-serif text-lg font-semibold tracking-tight text-ink">CallPilot</span>
            </div>
            <div className="flex items-center gap-2 sm:hidden">
              <ThemeToggle />
              <ConfigPill health={health} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <StageProgress current={stage} furthestReached={furthestReached} onNavigate={onNavigate} />
            <div className="hidden items-center gap-2 sm:flex">
              <ThemeToggle />
              <ConfigPill health={health} />
            </div>
          </div>
        </div>
      </header>

      <div className="border-b border-line bg-status-live-bg/40">
        <p className="mx-auto max-w-5xl px-4 py-1.5 text-xs text-ink-muted sm:px-6">
          {health?.call_mode === "telephony"
            ? "Places real outbound calls on your behalf and records them for your report."
            : "Runs live agent-to-agent negotiations and keeps full transcripts for your report."}{" "}
          Nothing runs until you confirm your details, and everything is kept only for this session.
        </p>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

function ConfigPill({ health }: { health: HealthStatus | null }) {
  if (!health) {
    return <span className="text-xs text-ink-muted">Checking setup…</span>;
  }
  const ready = health.ready_for_calls;
  const readyLabel = health.call_mode === "telephony" ? "Live calls ready" : "Simulation ready";
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        ready ? "border-status-done/30 bg-status-done-bg text-status-done" : "border-status-live/30 bg-status-live-bg text-status-live"
      )}
      title={ready ? `All required ${health.call_mode} configuration is present.` : `${health.missing_required_count} required setting(s) missing.`}
    >
      {ready ? <ShieldCheck className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
      {ready ? readyLabel : `${health.missing_required_count} setting${health.missing_required_count === 1 ? "" : "s"} needed`}
    </div>
  );
}
