"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Upload, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceIntakeWidget } from "@/components/voice-intake-widget";
import { Hero } from "@/components/hero";
import { api, ApiError } from "@/lib/api-client";
import type { HealthStatus, JobSpec } from "@/lib/types";

type FormState = {
  origin_address: string;
  destination_address: string;
  move_date: string;
  bedrooms: string;
  inventory_size: string;
  large_items: string; // comma-separated in the UI, array on the wire
  stairs_origin: string;
  stairs_destination: string;
  elevator_origin: boolean;
  elevator_destination: boolean;
  long_carry_expected: boolean;
  packing_preference: string;
  special_handling_notes: string;
};

function jobToForm(job: JobSpec): FormState {
  const f = job.fields;
  return {
    origin_address: (f.origin_address as string) ?? "",
    destination_address: (f.destination_address as string) ?? "",
    move_date: (f.move_date as string) ?? "",
    bedrooms: f.bedrooms != null ? String(f.bedrooms) : "",
    inventory_size: (f.inventory_size as string) ?? "",
    large_items: Array.isArray(f.large_items) ? (f.large_items as string[]).join(", ") : "",
    stairs_origin: f.stairs_origin != null ? String(f.stairs_origin) : "",
    stairs_destination: f.stairs_destination != null ? String(f.stairs_destination) : "",
    elevator_origin: Boolean(f.elevator_origin),
    elevator_destination: Boolean(f.elevator_destination),
    long_carry_expected: Boolean(f.long_carry_expected),
    packing_preference: (f.packing_preference as string) ?? "",
    special_handling_notes: (f.special_handling_notes as string) ?? "",
  };
}

export function BriefStage({
  job,
  health,
  onJobUpdated,
  onConfirmed,
}: {
  job: JobSpec;
  health: HealthStatus | null;
  onJobUpdated: (job: JobSpec) => void;
  onConfirmed: (job: JobSpec) => void;
}) {
  const [form, setForm] = useState<FormState>(() => jobToForm(job));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [syncedJobId, setSyncedJobId] = useState(job.job_id);

  // Reset the form when we're handed a different job (e.g. after "start a
  // new job") — done during render per React's guidance for adjusting state
  // from changed props, not in an effect.
  if (job.job_id !== syncedJobId) {
    setSyncedJobId(job.job_id);
    setForm(jobToForm(job));
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildFieldsPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (form.origin_address) payload.origin_address = form.origin_address;
    if (form.destination_address) payload.destination_address = form.destination_address;
    if (form.move_date) payload.move_date = form.move_date;
    if (form.bedrooms) payload.bedrooms = Number(form.bedrooms);
    if (form.inventory_size) payload.inventory_size = form.inventory_size;
    if (form.large_items.trim())
      payload.large_items = form.large_items.split(",").map((s) => s.trim()).filter(Boolean);
    if (form.stairs_origin !== "") payload.stairs_origin = Number(form.stairs_origin);
    if (form.stairs_destination !== "") payload.stairs_destination = Number(form.stairs_destination);
    payload.elevator_origin = form.elevator_origin;
    payload.elevator_destination = form.elevator_destination;
    payload.long_carry_expected = form.long_carry_expected;
    if (form.packing_preference) payload.packing_preference = form.packing_preference;
    if (form.special_handling_notes) payload.special_handling_notes = form.special_handling_notes;
    return payload;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateIntake(job.job_id, buildFieldsPayload(), "manual_form");
      onJobUpdated(updated);
      toast.success("Details saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save details");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const updated = await api.uploadDocument(job.job_id, file);
      onJobUpdated(updated);
      setForm(jobToForm(updated));
      toast.success("Extracted details from your document — review below before confirming");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Document extraction failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      await api.updateIntake(job.job_id, buildFieldsPayload(), "manual_form");
      const confirmed = await api.confirmIntake(job.job_id);
      onConfirmed(confirmed);
      toast.success("Job spec confirmed — nothing changes now without starting a new job");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const missing = (err.body as { detail?: { missing_fields?: string[] } })?.detail?.missing_fields ?? [];
        toast.error(`Missing required fields: ${missing.join(", ")}`);
      } else {
        toast.error(err instanceof ApiError ? err.message : "Could not confirm job spec");
      }
    } finally {
      setConfirming(false);
    }
  }

  const provenance = job.field_sources;

  return (
    <div className="space-y-6">
      <Hero />
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Tell us about your move</h1>
        <p className="mt-1 text-sm text-ink-muted">
          This becomes the exact job spec every mover hears — the same details, in the same words, every call.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-action" /> Voice interview
          </CardTitle>
          <CardDescription>Talk through your move — takes about three minutes.</CardDescription>
        </CardHeader>
        <CardContent>
          <VoiceIntakeWidget agentId={health?.interview_agent_id ?? null} jobId={job.job_id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="size-4 text-action" /> Upload a photo, quote, or inventory list
          </CardTitle>
          <CardDescription>We&apos;ll extract what we can and show you exactly what came from it.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong bg-paper p-6 text-center cp-transition hover:border-action">
            {uploading ? <Loader2 className="size-5 animate-spin text-action" /> : <Upload className="size-5 text-ink-muted" />}
            <span className="text-sm text-ink-muted">
              {uploading ? "Extracting details…" : "Click to upload PNG / JPEG / WEBP — PDF pages must be exported as images first"}
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Move details</CardTitle>
          <CardDescription>Edit anything the interview or document upload got wrong — this is the spec that gets read to every mover.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Moving from" source={provenance.origin_address}>
              <Input value={form.origin_address} onChange={(e) => set("origin_address", e.target.value)} placeholder="Rock Hill, SC" />
            </Field>
            <Field label="Moving to" source={provenance.destination_address}>
              <Input value={form.destination_address} onChange={(e) => set("destination_address", e.target.value)} placeholder="Charlotte, NC" />
            </Field>
            <Field label="Move date" source={provenance.move_date}>
              <Input type="date" value={form.move_date} onChange={(e) => set("move_date", e.target.value)} />
            </Field>
            <Field label="Bedrooms" source={provenance.bedrooms}>
              <Input type="number" min={0} value={form.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} placeholder="2" />
            </Field>
            <Field label="Inventory size" source={provenance.inventory_size}>
              <Select value={form.inventory_size} onValueChange={(v) => set("inventory_size", v)}>
                <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="studio">Studio</SelectItem>
                  <SelectItem value="1br">1 bedroom</SelectItem>
                  <SelectItem value="2br">2 bedroom</SelectItem>
                  <SelectItem value="3br">3 bedroom</SelectItem>
                  <SelectItem value="4br+">4+ bedroom</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Packing preference" source={provenance.packing_preference}>
              <Select value={form.packing_preference} onValueChange={(v) => set("packing_preference", v)}>
                <SelectTrigger><SelectValue placeholder="Select preference" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="self_pack">I&apos;ll pack myself</SelectItem>
                  <SelectItem value="full_pack">Full-service packing</SelectItem>
                  <SelectItem value="partial_pack">Partial packing help</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Stairs at pickup (flights)" source={provenance.stairs_origin}>
              <Input type="number" min={0} value={form.stairs_origin} onChange={(e) => set("stairs_origin", e.target.value)} />
            </Field>
            <Field label="Stairs at drop-off (flights)" source={provenance.stairs_destination}>
              <Input type="number" min={0} value={form.stairs_destination} onChange={(e) => set("stairs_destination", e.target.value)} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-4">
            <Checkbox label="Elevator at pickup" checked={form.elevator_origin} onChange={(v) => set("elevator_origin", v)} />
            <Checkbox label="Elevator at drop-off" checked={form.elevator_destination} onChange={(v) => set("elevator_destination", v)} />
            <Checkbox label="Long carry expected (truck can't park close)" checked={form.long_carry_expected} onChange={(v) => set("long_carry_expected", v)} />
          </div>

          <Field label="Large or special items" source={provenance.large_items}>
            <Input
              value={form.large_items}
              onChange={(e) => set("large_items", e.target.value)}
              placeholder="piano, safe, pool table (comma-separated)"
            />
          </Field>

          <Field label="Anything else a mover should know" source={provenance.special_handling_notes}>
            <Textarea
              value={form.special_handling_notes}
              onChange={(e) => set("special_handling_notes", e.target.value)}
              placeholder="Tight parking, pets, HOA rules, timing constraints…"
            />
          </Field>

          {job.needs_review.length > 0 && (
            <Alert variant="warning">
              <AlertTitle>Needs your review</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {job.needs_review.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save details
            </Button>
            <Button onClick={handleConfirm} disabled={confirming}>
              {confirming ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Confirm &amp; continue to calls
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, source, children }: { label: string; source?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {source && <ProvenanceBadge source={source} />}
      </div>
      {children}
    </div>
  );
}

function ProvenanceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; variant: "action" | "done" | "pending" }> = {
    voice_interview: { label: "from voice", variant: "action" },
    document: { label: "from document", variant: "done" },
    manual_form: { label: "you entered", variant: "pending" },
  };
  const cfg = map[source] ?? { label: source, variant: "pending" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-line-strong accent-[var(--action)]"
      />
      {label}
    </label>
  );
}

export function BriefStageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
