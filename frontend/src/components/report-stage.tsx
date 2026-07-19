"use client";

import { useEffect, useRef, useState } from "react";
import { Trophy, AlertTriangle, FileText, RefreshCw, ShieldCheck, Volume2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { JobSpec, Quote, RankedQuote, Report } from "@/lib/types";

export function ReportStage({ job }: { job: JobSpec }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getReport(job.job_id);
      setReport(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate the report yet");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Deferred via microtask so the fetch's setState calls don't run
    // synchronously within the effect body itself (React 19 purity rule) —
    // behavior is identical, this just detaches the timing by one tick.
    void Promise.resolve().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.job_id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <Alert variant="warning">
        <AlertTriangle className="mt-0.5" />
        <AlertTitle>Report isn&apos;t ready yet</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{error}</p>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="size-3.5" /> Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const recommended = report.ranked_quotes.find((r) => r.quote.quote_id === report.recommended_quote_id);
  const savings =
    recommended && report.market_spread.max
      ? report.market_spread.max - (recommended.quote.post_negotiation_total ?? recommended.quote.total_price ?? 0)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">Your ranked comparison</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Generated from {report.ranked_quotes.length} usable quote(s) — click any price to see its transcript evidence.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>

      <AiDisclosureBanner />

      <Card className="border-action/30 bg-action/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-action" /> Recommendation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm leading-relaxed text-ink">{report.plain_language_summary}</p>
          {savings != null && savings > 0 && (
            <p className="text-xs text-status-done">
              That&apos;s ${savings.toLocaleString()} below the highest quote gathered (${report.market_spread.max.toLocaleString()}).
            </p>
          )}
          <div className="space-y-1 border-t border-line pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
              <Volume2 className="size-3.5 text-action" /> Listen to the recommendation
            </p>
            <audio controls preload="none" src={`/api/report/${report.job_id}/audio`} className="w-full">
              Your browser does not support audio playback.
            </audio>
          </div>
        </CardContent>
      </Card>

      {report.red_flags.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="mt-0.5" />
          <AlertTitle>Red flags detected</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {report.red_flags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-3 gap-3">
        <SpreadStat label="Lowest" value={report.market_spread.min} />
        <SpreadStat label="Median" value={report.market_spread.median} />
        <SpreadStat label="Highest" value={report.market_spread.max} />
      </div>

      {/* Desktop table */}
      <Card className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.ranked_quotes.map((rq) => (
              <ReportRow key={rq.quote.quote_id} rq={rq} isRecommended={rq.quote.quote_id === report.recommended_quote_id} />
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile cards */}
      <div className="space-y-3 sm:hidden">
        {report.ranked_quotes.map((rq) => (
          <ReportCard key={rq.quote.quote_id} rq={rq} isRecommended={rq.quote.quote_id === report.recommended_quote_id} />
        ))}
      </div>
    </div>
  );
}

function SpreadStat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="mt-1 text-lg font-semibold text-ink">${value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}

function ReportRow({ rq, isRecommended }: { rq: RankedQuote; isRecommended: boolean }) {
  const price = rq.quote.post_negotiation_total ?? rq.quote.total_price;
  return (
    <TableRow className={cn(isRecommended && "bg-action/5")}>
      <TableCell className="font-medium text-ink">#{rq.rank}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {rq.quote.company_name}
          {isRecommended && <Badge variant="action">Recommended</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <EvidenceDialog
            rq={rq}
            trigger={
              <button
                className="font-medium underline decoration-dotted underline-offset-4 hover:text-action cp-transition"
                title="View transcript evidence for this price"
              >
                ${price?.toLocaleString() ?? "—"}
              </button>
            }
          />
          {rq.quote.post_negotiation_total && rq.quote.post_negotiation_total !== rq.quote.pre_negotiation_total && (
            <span className="text-xs text-status-done">negotiated down</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge variant={rq.quote.binding ? "done" : "pending"}>{rq.quote.binding ? "Binding" : "Rough"}</Badge>
          <RiskBadge quote={rq.quote} />
        </div>
      </TableCell>
      <TableCell className="max-w-xs text-xs text-ink-muted">{rq.score_notes}</TableCell>
      <TableCell>
        <TranscriptButton rq={rq} />
      </TableCell>
    </TableRow>
  );
}

function ReportCard({ rq, isRecommended }: { rq: RankedQuote; isRecommended: boolean }) {
  const price = rq.quote.post_negotiation_total ?? rq.quote.total_price;
  return (
    <Card className={cn(isRecommended && "border-action/40 bg-action/5")}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-ink">
            #{rq.rank} {rq.quote.company_name}
          </span>
          {isRecommended && <Badge variant="action">Recommended</Badge>}
        </div>
        <EvidenceDialog
          rq={rq}
          trigger={
            <button className="text-lg font-semibold text-ink underline decoration-dotted underline-offset-4 hover:text-action cp-transition">
              ${price?.toLocaleString() ?? "—"}
            </button>
          }
        />
        <div className="flex flex-wrap gap-1">
          <Badge variant={rq.quote.binding ? "done" : "pending"}>{rq.quote.binding ? "Binding" : "Rough"}</Badge>
          <RiskBadge quote={rq.quote} />
        </div>
        <p className="text-xs text-ink-muted">{rq.score_notes}</p>
        {rq.quote.line_items.length > 0 && (
          <ul className="space-y-0.5 border-t border-line pt-2 text-xs text-ink-muted">
            {rq.quote.line_items.map((li, i) => (
              <li key={i} className="flex justify-between">
                <span>{li.label}</span>
                <span>${li.amount.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
        <TranscriptButton rq={rq} />
      </CardContent>
    </Card>
  );
}

function RiskBadge({ quote }: { quote: Quote }) {
  if (!quote.is_red_flag) return <Badge variant="done">Verified</Badge>;
  return (
    <Badge variant="flag" title={quote.red_flag_reason ?? undefined}>
      <AlertTriangle className="size-3" />
      {quote.red_flag_pct_below_market != null
        ? `Flagged: ${quote.red_flag_pct_below_market}% below benchmark`
        : "Flagged"}
    </Badge>
  );
}

function AiDisclosureBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper-raised px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
        <ShieldCheck className="size-3.5 text-action" /> AI-Powered Negotiator — full disclosure on every call
      </span>
      <Dialog>
        <DialogTrigger asChild>
          <button className="text-xs text-action underline underline-offset-2 hover:opacity-80">View disclosure</button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI disclosure &amp; honesty constraints</DialogTitle>
            <DialogDescription>How the CallPilot agent operates on every call</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-2 pl-5 text-sm text-ink">
            <li>The agent discloses that it is an AI assistant calling on a customer&apos;s behalf at the start of every call, and confirms it plainly if asked (&quot;am I talking to a robot?&quot;).</li>
            <li>It never invents inventory, access details, or competing bids. The only leverage it may cite is a real quote it actually gathered on a prior call — the number is passed in from the recorded quote, so a fabricated figure is impossible by construction.</li>
            <li>Every call ends in exactly one structured outcome: an itemized quote, a callback commitment, a documented refusal to quote by phone, a decline, or a hang-up — never a vague impression.</li>
            <li>Quotes 30%+ below the market benchmark are flagged as risks, not wins, along with non-binding numbers and missing itemizations.</li>
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Turns that look like they carry pricing evidence (dollar amounts, fees). */
const EVIDENCE_RE = /\$\s?\d|\d[\d,]*\s*(dollars|bucks)|\b(fee|surcharge|deposit|total|binding|firm)\b/i;

function EvidenceDialog({ rq, trigger }: { rq: RankedQuote; trigger: React.ReactElement }) {
  const scrolledRef = useRef(false);
  if (!rq.call.transcript.length) return trigger;
  const firstEvidenceIdx = rq.call.transcript.findIndex((t) => EVIDENCE_RE.test(t.text));
  return (
    <Dialog onOpenChange={() => (scrolledRef.current = false)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rq.quote.company_name} — transcript evidence</DialogTitle>
          <DialogDescription>
            Highlighted turns are where prices and fees were stated on the call. Nothing in this report exists
            without a line here.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {rq.call.transcript.map((turn, i) => {
            const isEvidence = EVIDENCE_RE.test(turn.text);
            return (
              <div
                key={i}
                ref={
                  i === firstEvidenceIdx
                    ? (el) => {
                        if (el && !scrolledRef.current) {
                          scrolledRef.current = true;
                          setTimeout(() => el.scrollIntoView({ block: "center" }), 50);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "rounded-md px-3 py-2 text-sm",
                  turn.speaker === "agent" ? "bg-action/10" : "bg-paper",
                  isEvidence && "ring-1 ring-action/60"
                )}
              >
                <span className="mb-0.5 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {turn.speaker === "agent" ? "CallPilot agent" : rq.quote.company_name}
                  {isEvidence && <span className="normal-case text-action">§ evidence</span>}
                </span>
                {turn.text}
              </div>
            );
          })}
        </div>
        {rq.call.recording_url && (
          <div className="space-y-1">
            <audio controls preload="none" src={rq.call.recording_url} className="w-full">
              Your browser does not support audio playback.
            </audio>
            {rq.call.mode === "simulation" && (
              <p className="text-[11px] text-ink-muted">AI-voiced replay of this call&apos;s actual transcript.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TranscriptButton({ rq }: { rq: RankedQuote }) {
  if (!rq.call.transcript.length) return null;
  return (
    <EvidenceDialog
      rq={rq}
      trigger={
        <Button variant="outline" size="sm">
          <FileText className="size-3.5" /> Transcript
        </Button>
      }
    />
  );
}
