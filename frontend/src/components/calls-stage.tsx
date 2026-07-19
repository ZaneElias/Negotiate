"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, PhoneCall, PhoneOff, Search, Plus, X, Loader2, FileText, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SetupPanel } from "@/components/setup-panel";
import { api, ApiError } from "@/lib/api-client";
import { usePolling } from "@/hooks/use-polling";
import { cn } from "@/lib/utils";
import type { CallListResult, CallOutcome, CallRecord, CallStatus, HealthStatus, JobSpec, NegotiationStyle, Quote } from "@/lib/types";

// Every call ends in exactly one structured outcome — surface each one
// explicitly, including the "failure" modes the agent handled gracefully.
const OUTCOME_BADGES: Record<CallOutcome, { variant: "done" | "pending" | "live" | "flag"; label: string }> = {
  quote_given: { variant: "done", label: "Quote received" },
  callback_promised: { variant: "pending", label: "Callback promised" },
  no_prices_over_phone: { variant: "live", label: "Won't quote by phone" },
  declined: { variant: "flag", label: "Declined to quote" },
  hang_up: { variant: "flag", label: "Hung up" },
  unreachable: { variant: "flag", label: "Unreachable" },
};

const STYLE_LABELS: Record<NegotiationStyle, string> = {
  tough_negotiator: "Tough negotiator",
  stonewaller: "Stonewaller",
  hard_sell_upseller: "Hard-sell upseller",
  straight_shooter: "Straight shooter",
};

const TERMINAL_STATUSES: CallStatus[] = ["completed", "failed", "no_answer"];

type DraftTarget = { company_name: string; phone_number?: string; negotiation_style_label?: NegotiationStyle };

export function CallsStage({
  job,
  health,
  onCallsStarted,
  onAdvance,
}: {
  job: JobSpec;
  health: HealthStatus | null;
  onCallsStarted: () => void;
  onAdvance: () => void;
}) {
  const [mode, setMode] = useState<"demo" | "real">("demo");
  const [draftTargets, setDraftTargets] = useState<DraftTarget[]>([]);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);

  const [searchCategory, setSearchCategory] = useState("moving companies");
  const [searchLocation, setSearchLocation] = useState(String(job.fields.destination_address ?? ""));
  const [searchResults, setSearchResults] = useState<CallListResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const callsActive = started;

  const { data: calls, error: callsError } = usePolling<CallRecord[]>({
    fn: () => api.listCalls(job.job_id),
    active: callsActive,
    intervalMs: 3500,
  });

  const allTerminal = calls != null && calls.length > 0 && calls.every((c) => TERMINAL_STATUSES.includes(c.status));

  const { data: quotes } = usePolling<Quote[]>({
    fn: () => api.listQuotes(job.job_id),
    active: callsActive,
    intervalMs: 3500,
  });

  useEffect(() => {
    if (started) onCallsStarted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  function addDemoPersona(style: NegotiationStyle, label: string) {
    if (draftTargets.some((t) => t.negotiation_style_label === style)) return;
    setDraftTargets((prev) => [...prev, { company_name: `${label} (demo)`, negotiation_style_label: style }]);
  }

  function removeTarget(idx: number) {
    setDraftTargets((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSearch() {
    setSearching(true);
    try {
      const results = await api.searchCallList(searchCategory, searchLocation);
      setSearchResults(results);
      if (results.length === 0) toast.info("No businesses found — try a broader location or category.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Call-list search failed");
    } finally {
      setSearching(false);
    }
  }

  function addSearchResult(r: CallListResult) {
    if (draftTargets.some((t) => t.phone_number === r.phone_number)) return;
    setDraftTargets((prev) => [...prev, { company_name: r.name, phone_number: r.phone_number }]);
  }

  function addManual() {
    if (!manualName.trim() || !manualPhone.trim()) return;
    setDraftTargets((prev) => [...prev, { company_name: manualName.trim(), phone_number: manualPhone.trim() }]);
    setManualName("");
    setManualPhone("");
  }

  const isSimulation = health?.call_mode === "simulation";

  async function handleStartCalls() {
    setStarting(true);
    try {
      if (isSimulation) {
        const styles = draftTargets
          .map((t) => t.negotiation_style_label)
          .filter((s): s is NegotiationStyle => Boolean(s));
        if (styles.length < 3) {
          toast.error("Simulation mode runs the demo personas — add at least 3 personas (real-business calls need telephony mode).");
          return;
        }
        const records = await api.simulateCalls(job.job_id, styles);
        setStarted(true);
        toast.success(`Ran ${records.length} agent-to-agent negotiations`);
      } else {
        await api.startCalls(job.job_id, draftTargets);
        setStarted(true);
        toast.success(`Placed ${draftTargets.length} calls`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start calls");
    } finally {
      setStarting(false);
    }
  }

  const quotesByCallId = useMemo(() => {
    const map = new Map<string, Quote>();
    (quotes ?? []).forEach((q) => map.set(q.call_id, q));
    return map;
  }, [quotes]);

  if (!health) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Gather quotes</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every call describes your move identically — same spec, every time — so the quotes are actually comparable.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-line bg-paper-raised px-3 py-2 text-xs text-ink-muted">
        <Badge variant={isSimulation ? "action" : "live"}>{isSimulation ? "Simulation" : "Telephony"}</Badge>
        {isSimulation
          ? "Agent-to-agent via ElevenLabs — the Caller negotiates each counterparty live and unscripted. Real Twilio voice is also wired (CALL_MODE=telephony); this reproducible path is shown here."
          : "Real outbound voice calls over Twilio/SIP, with a playable recording on each call."}
      </div>

      {!health.ready_for_calls && <SetupPanel health={health} />}

      {!started && (
        <Card>
          <CardHeader>
            <CardTitle>Who should we call?</CardTitle>
            <CardDescription>At least three distinct negotiation styles — mix demo personas and real businesses as you like.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex gap-2">
              <Button variant={mode === "demo" ? "default" : "outline"} size="sm" onClick={() => setMode("demo")}>
                Demo personas
              </Button>
              <Button variant={mode === "real" ? "default" : "outline"} size="sm" onClick={() => setMode("real")}>
                Real businesses
              </Button>
            </div>

            {mode === "demo" && <DemoPersonaPicker onAdd={addDemoPersona} draftTargets={draftTargets} />}

            {mode === "real" && (
              <div className="space-y-4">
                {isSimulation && (
                  <p className="rounded-md bg-paper px-3 py-2 text-xs text-status-live">
                    You&apos;re in simulation mode — real businesses can be sourced here to show where the call list
                    comes from, but placing live calls to them needs telephony mode (<code>CALL_MODE=telephony</code>).
                  </p>
                )}
                {health.call_list_source !== "manual" ? (
                  <div className="space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input value={searchCategory} onChange={(e) => setSearchCategory(e.target.value)} placeholder="moving companies" />
                      <Input value={searchLocation} onChange={(e) => setSearchLocation(e.target.value)} placeholder="Charlotte, NC" />
                      <Button onClick={handleSearch} disabled={searching}>
                        {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                        Search
                      </Button>
                    </div>
                    {searchResults.length > 0 && (
                      <div className="space-y-2">
                        {searchResults.map((r) => (
                          <div key={r.phone_number} className="flex items-center justify-between rounded-md border border-line bg-paper p-2.5 text-sm">
                            <div>
                              <p className="font-medium text-ink">{r.name}</p>
                              <p className="text-xs text-ink-muted">{r.phone_number}{r.rating ? ` · ${r.rating}★ (${r.user_rating_count})` : ""}</p>
                            </div>
                            <Button size="sm" variant="outline" onClick={() => addSearchResult(r)}>
                              <Plus className="size-3.5" /> Add
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">
                    Call-list search isn&apos;t configured (set <code>TAVILY_API_KEY</code> or <code>GOOGLE_PLACES_API_KEY</code>) — add businesses manually below.
                  </p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Company name" />
                  <Input value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} placeholder="+1 555 123 4567" />
                  <Button variant="outline" onClick={addManual}>
                    <Plus className="size-4" /> Add
                  </Button>
                </div>
              </div>
            )}

            {draftTargets.length > 0 && (
              <div className="space-y-2 border-t border-line pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Call list ({draftTargets.length})</p>
                {draftTargets.map((t, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md bg-paper px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{t.company_name}</span>
                      {t.negotiation_style_label && <Badge variant="action">{STYLE_LABELS[t.negotiation_style_label]}</Badge>}
                      {t.phone_number && <span className="text-xs text-ink-muted">{t.phone_number}</span>}
                    </div>
                    <button onClick={() => removeTarget(i)} className="text-ink-muted hover:text-status-flag">
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button onClick={handleStartCalls} disabled={draftTargets.length < 3 || starting || !health.ready_for_calls} className="w-full sm:w-auto">
              {starting ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
              {isSimulation
                ? `Run ${draftTargets.length || ""} agent-to-agent ${draftTargets.length === 1 ? "negotiation" : "negotiations"}`
                : `Call all ${draftTargets.length || ""} ${draftTargets.length === 1 ? "company" : "companies"}`}
            </Button>
            {draftTargets.length > 0 && draftTargets.length < 3 && (
              <p className="text-xs text-status-live">Add at least 3 targets to cover distinct negotiation styles.</p>
            )}
          </CardContent>
        </Card>
      )}

      {started && (
        <div className="space-y-4">
          {callsError != null && (
            <p className="text-xs text-status-live">Having trouble refreshing call status — will keep retrying automatically.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {(calls ?? []).map((call) => (
              <CallCard key={call.call_id} call={call} quote={quotesByCallId.get(call.call_id)} />
            ))}
            {calls == null && Array.from({ length: draftTargets.length || 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
          </div>

          {allTerminal && (
            <Card className="border-status-done/30 bg-status-done-bg/40">
              <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
                <p className="text-sm text-ink">All calls have reached a final state — ready to negotiate with the leverage you gathered.</p>
                <Button onClick={onAdvance}>
                  Continue to negotiation <ArrowRight className="size-4" />
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function DemoPersonaPicker({
  onAdd,
  draftTargets,
}: {
  onAdd: (style: NegotiationStyle, label: string) => void;
  draftTargets: DraftTarget[];
}) {
  const [roster, setRoster] = useState<{ style: string; description: string; configured: boolean }[] | null>(null);

  useEffect(() => {
    api.counterpartyRoster().then(setRoster).catch(() => setRoster([]));
  }, []);

  if (roster == null) return <Skeleton className="h-24 w-full" />;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {roster.map((r) => {
        const style = r.style as NegotiationStyle;
        const added = draftTargets.some((t) => t.negotiation_style_label === style);
        return (
          <button
            key={r.style}
            onClick={() => onAdd(style, STYLE_LABELS[style])}
            disabled={added || !r.configured}
            className={cn(
              "flex flex-col gap-1 rounded-lg border p-3 text-left cp-transition",
              added ? "border-status-done/40 bg-status-done-bg" : "border-line bg-paper hover:border-action",
              !r.configured && "cursor-not-allowed opacity-50"
            )}
          >
            <span className="text-sm font-medium text-ink">{STYLE_LABELS[style]}</span>
            <span className="text-xs text-ink-muted">{r.description}</span>
            {!r.configured && <span className="text-xs text-status-live">Number not configured</span>}
            {added && <span className="text-xs text-status-done">Added</span>}
          </button>
        );
      })}
    </div>
  );
}

const STATUS_BADGE: Record<CallStatus, { variant: "live" | "done" | "flag" | "pending"; label: string }> = {
  queued: { variant: "pending", label: "Queued" },
  dialing: { variant: "live", label: "Dialing" },
  in_progress: { variant: "live", label: "Live" },
  completed: { variant: "done", label: "Completed" },
  failed: { variant: "flag", label: "Failed" },
  no_answer: { variant: "flag", label: "No answer" },
};

function CallCard({ call, quote }: { call: CallRecord; quote?: Quote }) {
  const badge = STATUS_BADGE[call.status];
  const elapsed = useElapsed(call.started_at, call.ended_at);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium text-ink">{call.company_name}</p>
            <p className="text-xs text-ink-muted">
              {call.negotiation_style_label ? STYLE_LABELS[call.negotiation_style_label] : "Real business"}
              {call.is_negotiation_callback && " · negotiation callback"}
            </p>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>

        <div className="flex items-center gap-3 text-xs text-ink-muted">
          {call.status === "in_progress" || call.status === "dialing" ? (
            <span className="flex items-center gap-1"><Phone className="size-3 animate-pulse" /> {elapsed}</span>
          ) : call.ended_at ? (
            <span>{elapsed}</span>
          ) : null}
          {call.error && <span className="text-status-flag">{call.error}</span>}
        </div>

        {quote && (
          <div className="rounded-md bg-paper p-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              {quote.outcome === "quote_given" ? (
                <>
                  <span className="font-medium text-ink">
                    {quote.total_price != null ? `$${quote.total_price.toLocaleString()}` : "—"}
                  </span>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Badge variant={quote.binding ? "done" : "pending"}>{quote.binding ? "Binding" : "Rough estimate"}</Badge>
                    {quote.is_red_flag && (
                      <Badge variant="flag" title={quote.red_flag_reason ?? undefined}>
                        {quote.red_flag_pct_below_market != null
                          ? `Flagged: ${quote.red_flag_pct_below_market}% below benchmark`
                          : "Flagged"}
                      </Badge>
                    )}
                  </div>
                </>
              ) : (
                <Badge variant={OUTCOME_BADGES[quote.outcome].variant}>{OUTCOME_BADGES[quote.outcome].label}</Badge>
              )}
            </div>
            {quote.outcome !== "quote_given" && quote.callback_time && (
              <p className="mt-1 text-xs text-ink-muted">Callback expected: {new Date(quote.callback_time).toLocaleString()}</p>
            )}
            {quote.outcome !== "quote_given" && quote.negotiation_notes && (
              <p className="mt-1 text-xs text-ink-muted">{quote.negotiation_notes}</p>
            )}
            {quote.line_items.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-xs text-ink-muted">
                {quote.line_items.map((li, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{li.label}</span>
                    <span>${li.amount.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {call.transcript.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
                <FileText className="size-3.5" /> View transcript
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{call.company_name}</DialogTitle>
                <DialogDescription>
                  {call.negotiation_style_label ? STYLE_LABELS[call.negotiation_style_label] : "Real business"} · {call.phone_number}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {call.transcript.map((turn, i) => (
                  <div key={i} className={cn("rounded-md px-3 py-2 text-sm", turn.speaker === "agent" ? "bg-action/10 text-ink" : "bg-paper text-ink")}>
                    <span className="mb-0.5 block text-xs font-medium uppercase tracking-wide text-ink-muted">
                      {turn.speaker === "agent" ? "CallPilot agent" : call.company_name}
                    </span>
                    {turn.text}
                  </div>
                ))}
              </div>
              {call.recording_url && (
                <div className="space-y-1">
                  <audio controls preload="none" src={call.recording_url} className="w-full">
                    Your browser does not support audio playback.
                  </audio>
                  {call.mode === "simulation" && (
                    <p className="text-[11px] text-ink-muted">
                      AI-voiced replay of this call&apos;s actual transcript (generated on first play).
                    </p>
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}

        {call.status === "failed" && !call.transcript.length && (
          <div className="flex items-center gap-1.5 text-xs text-status-flag">
            <PhoneOff className="size-3" /> Call did not connect
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function useElapsed(startedAt: string | null, endedAt: string | null): string {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (endedAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endedAt]);

  if (!startedAt) return "";
  // Backend timestamps are naive UTC (no offset); parse them as UTC so the live
  // elapsed clock doesn't jump by the viewer's timezone offset.
  const asUtc = (s: string) => new Date(/[Z+]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`).getTime();
  const start = asUtc(startedAt);
  const end = endedAt ? asUtc(endedAt) : nowMs;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
