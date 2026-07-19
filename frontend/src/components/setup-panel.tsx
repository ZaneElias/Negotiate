"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { HealthStatus } from "@/lib/types";
import { Settings2 } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  openai: "OpenAI (document extraction + report)",
  elevenlabs: "ElevenLabs Caller agent",
  telephony: "Telephony (real voice calls)",
  demo_personas: "Counterparty phone numbers (telephony demo)",
  voice_intake: "ElevenLabs voice-interview agent (optional)",
  call_list: "Call-list search — Tavily or Google Places (optional)",
};

export function SetupPanel({ health }: { health: HealthStatus }) {
  const requiredMissing = Object.entries(health.categories).filter(
    ([, cat]) => cat.required && cat.missing.length > 0
  );

  if (requiredMissing.length === 0) return null;

  return (
    <Alert variant="warning" className="space-y-3">
      <div className="flex items-start gap-2">
        <Settings2 className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <AlertTitle>
            {health.call_mode === "telephony" ? "Telephony isn't configured yet" : "Calls aren't configured yet"}
          </AlertTitle>
          <AlertDescription>
            CallPilot never fakes a call — the settings below need real values in your backend environment first.
            Intake works fully without them. {health.call_mode === "simulation"
              ? "Simulation mode needs only your ElevenLabs key + a created Caller agent."
              : "Telephony additionally needs a caller phone number and a public webhook URL."}
          </AlertDescription>
        </div>
      </div>

      <div className="space-y-3 pl-6">
        {requiredMissing.map(([category, cat]) => (
          <div key={category} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">{CATEGORY_LABELS[category] ?? category}</span>
              <Badge variant="flag">{cat.missing.length} missing</Badge>
            </div>
            <ul className="space-y-1">
              {cat.missing.map((v) => (
                <li key={v.name} className="text-xs text-ink-muted">
                  <code className="rounded bg-paper px-1 py-0.5 font-mono text-[11px] text-ink">{v.name}</code>
                  {" — "}
                  {v.description}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-line bg-paper-raised p-3 text-xs text-ink-muted">
        <p className="mb-1 font-medium text-ink">Fastest path — one command:</p>
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>Put <code>ELEVENLABS_API_KEY</code>, <code>OPENAI_API_KEY</code>, <code>TAVILY_API_KEY</code> in <code>backend/.env</code>.</li>
          <li>Run <code>python scripts/provision_agents.py</code> — it creates the Caller + interview agents and the <code>log_quote</code>/<code>log_intake_field</code> tools, then prints the agent IDs to paste back.</li>
          <li>That&apos;s enough for <span className="font-medium text-ink">simulation mode</span> (agent-to-agent, no Twilio).</li>
          <li>For real voice, also set <code>CALL_MODE=telephony</code>, <code>WEBHOOK_BASE_URL</code>, and a caller phone-number id; re-run with <code>--counterparties</code> for the demo personas.</li>
        </ol>
      </div>
    </Alert>
  );
}
