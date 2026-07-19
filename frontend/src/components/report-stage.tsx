"use client";

import { useEffect, useState } from "react";
import { Trophy, AlertTriangle, FileText, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { JobSpec, RankedQuote, Report } from "@/lib/types";

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
            Generated from {report.ranked_quotes.length} usable quote(s), with transcript evidence for each.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>

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
          <span className="font-medium">${price?.toLocaleString() ?? "—"}</span>
          {rq.quote.post_negotiation_total && rq.quote.post_negotiation_total !== rq.quote.pre_negotiation_total && (
            <span className="text-xs text-status-done">negotiated down</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge variant={rq.quote.binding ? "done" : "pending"}>{rq.quote.binding ? "Binding" : "Rough"}</Badge>
          {rq.quote.is_red_flag && <Badge variant="flag">Red flag</Badge>}
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
        <p className="text-lg font-semibold text-ink">${price?.toLocaleString() ?? "—"}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant={rq.quote.binding ? "done" : "pending"}>{rq.quote.binding ? "Binding" : "Rough"}</Badge>
          {rq.quote.is_red_flag && <Badge variant="flag">Red flag</Badge>}
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

function TranscriptButton({ rq }: { rq: RankedQuote }) {
  if (!rq.call.transcript.length) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText className="size-3.5" /> Transcript
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rq.quote.company_name}</DialogTitle>
          <DialogDescription>{rq.quote.phone_number}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {rq.call.transcript.map((turn, i) => (
            <div key={i} className={cn("rounded-md px-3 py-2 text-sm", turn.speaker === "agent" ? "bg-action/10" : "bg-paper")}>
              <span className="mb-0.5 block text-xs font-medium uppercase tracking-wide text-ink-muted">
                {turn.speaker === "agent" ? "CallPilot agent" : rq.quote.company_name}
              </span>
              {turn.text}
            </div>
          ))}
        </div>
        {rq.call.recording_url && (
          <div className="space-y-1">
            <audio controls preload="none" src={rq.call.recording_url} className="w-full">
              Your browser does not support audio playback.
            </audio>
            {rq.call.mode === "simulation" && (
              <p className="text-[11px] text-ink-muted">
                AI-voiced replay of this call&apos;s actual transcript (generated on first play).
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
