"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stage } from "@/lib/types";

const STAGES: { key: Stage; label: string }[] = [
  { key: "brief", label: "Brief" },
  { key: "calls", label: "Calls" },
  { key: "negotiate", label: "Negotiate" },
  { key: "report", label: "Report" },
];

export function StageProgress({
  current,
  furthestReached,
  onNavigate,
}: {
  current: Stage;
  furthestReached: Stage;
  onNavigate?: (stage: Stage) => void;
}) {
  const currentIdx = STAGES.findIndex((s) => s.key === current);
  const furthestIdx = STAGES.findIndex((s) => s.key === furthestReached);

  return (
    <nav aria-label="Job progress" className="flex items-center gap-1.5 sm:gap-2">
      {STAGES.map((stage, i) => {
        const isDone = i < furthestIdx;
        const isCurrent = stage.key === current;
        const isReachable = i <= furthestIdx;
        return (
          <div key={stage.key} className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={!isReachable}
              onClick={() => isReachable && onNavigate?.(stage.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium cp-transition sm:px-3 sm:text-sm",
                isCurrent && "border-action bg-action text-action-foreground",
                !isCurrent && isDone && "border-status-done/30 bg-status-done-bg text-status-done hover:opacity-80",
                !isCurrent && !isDone && isReachable && "border-line-strong bg-paper-raised text-ink hover:bg-paper",
                !isReachable && "border-line bg-paper text-ink-muted/50 cursor-not-allowed"
              )}
            >
              {isDone ? <Check className="size-3" /> : <span className="tabular-nums">{i + 1}</span>}
              <span className="hidden sm:inline">{stage.label}</span>
            </button>
            {i < STAGES.length - 1 && (
              <div className={cn("h-px w-3 sm:w-6", i < currentIdx || i < furthestIdx ? "bg-status-done/40" : "bg-line-strong")} />
            )}
          </div>
        );
      })}
    </nav>
  );
}
