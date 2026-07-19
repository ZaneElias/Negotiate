"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { TrendingDown, PhoneCall, ArrowRight, Loader2, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SetupPanel } from "@/components/setup-panel";
import { api, ApiError } from "@/lib/api-client";
import { usePolling } from "@/hooks/use-polling";
import { cn } from "@/lib/utils";
import type { CallRecord, HealthStatus, JobSpec, Quote } from "@/lib/types";

export function NegotiateStage({
  job,
  health,
  onAdvance,
}: {
  job: JobSpec;
  health: HealthStatus | null;
  onAdvance: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [selectedCallIds, setSelectedCallIds] = useState<Set<string>>(new Set());
  const [lastSyncedIds, setLastSyncedIds] = useState<string>("");

  const { data: calls } = usePolling<CallRecord[]>({
    fn: () => api.listCalls(job.job_id, false),
    active: true,
    intervalMs: 5000,
  });

  const { data: quotes } = usePolling<Quote[]>({
    fn: () => api.listQuotes(job.job_id),
    active: true,
    intervalMs: 3500,
  });

  const usableQuotes = useMemo(
    () => (quotes ?? []).filter((q) => q.outcome === "quote_given" && q.total_price != null),
    [quotes]
  );
  const cheapest = useMemo(
    () => (usableQuotes.length ? usableQuotes.reduce((a, b) => ((a.total_price ?? Infinity) <= (b.total_price ?? Infinity) ? a : b)) : null),
    [usableQuotes]
  );
  const negotiableQuotes = usableQuotes.filter((q) => q.quote_id !== cheapest?.quote_id);

  // Reset the default selection when the set of negotiable quotes changes —
  // done during render (not in an effect) per React's guidance for
  // adjusting state when derived inputs change, avoiding an extra render pass.
  const negotiableIdsKey = negotiableQuotes.map((q) => q.call_id).join(",");
  if (negotiableIdsKey !== lastSyncedIds) {
    setLastSyncedIds(negotiableIdsKey);
    setSelectedCallIds(new Set(negotiableQuotes.map((q) => q.call_id)));
  }

  const callsByCallId = useMemo(() => {
    const map = new Map<string, CallRecord>();
    (calls ?? []).forEach((c) => map.set(c.call_id, c));
    return map;
  }, [calls]);

  const negotiationCalls = (calls ?? []).filter((c) => c.is_negotiation_callback);
  const negotiationDone =
    started && negotiationCalls.length > 0 && negotiationCalls.every((c) => ["completed", "failed", "no_answer"].includes(c.status));

  function toggleCall(callId: string) {
    setSelectedCallIds((prev) => {
      const next = new Set(prev);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  }

  const isSimulation = health?.call_mode === "simulation";

  async function handleStartNegotiation() {
    if (!cheapest) return;
    setStarting(true);
    try {
      if (isSimulation) {
        await api.simulateNegotiation(job.job_id, Array.from(selectedCallIds));
        toast.success("Ran negotiation callbacks");
      } else {
        await api.startNegotiation(job.job_id, Array.from(selectedCallIds));
        toast.success("Negotiation calls placed");
      }
      setStarted(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start negotiation");
    } finally {
      setStarting(false);
    }
  }

  if (quotes == null) return <Skeleton className="h-64 w-full" />;

  if (usableQuotes.length < 2) {
    return (
      <Alert variant="warning">
        <AlertTitle>Not enough quotes to negotiate yet</AlertTitle>
        <AlertDescription>
          Need at least two usable quotes to use one as leverage against another. Go back to Calls if any are still pending.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Negotiate with leverage</h1>
        <p className="mt-1 text-sm text-ink-muted">
          We call back the other companies and cite your best real quote — never a number that wasn&apos;t actually gathered.
        </p>
      </div>

      {!health?.ready_for_calls && health && <SetupPanel health={health} />}

      {cheapest && (
        <Card className="border-status-done/30 bg-status-done-bg/30">
          <CardContent className="flex items-center gap-3 p-4">
            <TrendingDown className="size-5 text-status-done" />
            <div>
              <p className="text-sm text-ink">
                Using <span className="font-semibold">{cheapest.company_name}</span>&apos;s{" "}
                <span className="font-semibold">${cheapest.total_price?.toLocaleString()}</span> as leverage
                {cheapest.binding ? "" : " (not yet confirmed binding)"}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!started && (
        <Card>
          <CardHeader>
            <CardTitle>Call back for a better price</CardTitle>
            <CardDescription>Select who to call back — each call cites the leverage quote above and pushes on unitemized fees.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {negotiableQuotes.map((q) => (
                <label key={q.quote_id} className="flex items-center justify-between rounded-md border border-line bg-paper px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedCallIds.has(q.call_id)}
                      onChange={() => toggleCall(q.call_id)}
                      className="size-4 rounded border-line-strong accent-[var(--action)]"
                    />
                    <div>
                      <p className="font-medium text-ink">{q.company_name}</p>
                      <p className="text-xs text-ink-muted">
                        Currently ${q.total_price?.toLocaleString()}{q.is_red_flag ? " · flagged" : ""}
                      </p>
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <Button onClick={handleStartNegotiation} disabled={selectedCallIds.size === 0 || starting || !health?.ready_for_calls}>
              {starting ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
              Call back {selectedCallIds.size || ""} {selectedCallIds.size === 1 ? "company" : "companies"} with leverage
            </Button>
          </CardContent>
        </Card>
      )}

      {started && (
        <div className="space-y-3">
          {Array.from(selectedCallIds).map((originalCallId) => {
            const original = callsByCallId.get(originalCallId);
            // The company keeps a single quote; negotiation updates it in place
            // with pre_/post_negotiation_total, so read the move off that quote.
            const companyQuote = (quotes ?? []).find((q) => q.call_id === originalCallId);
            const callbackCall = negotiationCalls.find((c) => c.company_name === original?.company_name);
            return (
              <PriceMoveCard
                key={originalCallId}
                companyName={original?.company_name ?? "—"}
                before={companyQuote?.pre_negotiation_total ?? companyQuote?.total_price ?? null}
                after={companyQuote?.post_negotiation_total ?? null}
                status={callbackCall?.status ?? "queued"}
                notes={companyQuote?.negotiation_notes ?? null}
              />
            );
          })}

          {negotiationDone && (
            <Card className="border-action/30 bg-action/5">
              <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
                <p className="text-sm text-ink">Negotiation calls are complete — see the full ranked comparison.</p>
                <Button onClick={onAdvance}>
                  View report <ArrowRight className="size-4" />
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!started && (
        <Button variant="ghost" size="sm" onClick={onAdvance}>
          Skip negotiation and view report <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}

function PriceMoveCard({
  companyName,
  before,
  after,
  status,
  notes,
}: {
  companyName: string;
  before: number | null;
  after: number | null;
  status: string;
  notes: string | null;
}) {
  const moved = before != null && after != null && before !== after;
  const isTerminal = ["completed", "failed", "no_answer"].includes(status);

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-ink">{companyName}</p>
          {notes && <p className="text-xs text-ink-muted">{notes}</p>}
        </div>
        <div className="flex items-center gap-3">
          {!isTerminal ? (
            <Badge variant="live">Calling back…</Badge>
          ) : (
            <>
              <span className={cn("text-sm", moved ? "text-ink-muted line-through" : "text-ink")}>
                {before != null ? `$${before.toLocaleString()}` : "—"}
              </span>
              {moved ? (
                <>
                  <TrendingDown className="size-4 text-status-done" />
                  <span className="text-sm font-semibold text-status-done">${after?.toLocaleString()}</span>
                </>
              ) : (
                <span className="flex items-center gap-1 text-xs text-ink-muted">
                  <Minus className="size-3" /> No change
                </span>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
