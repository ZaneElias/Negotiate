"use client";

import { useEffect, useRef } from "react";
import { Mic } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const WIDGET_SCRIPT_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";

/**
 * Embeds the ElevenLabs <elevenlabs-convai> voice-interview widget when
 * ELEVENLABS_INTERVIEW_AGENT_ID is configured server-side. The agent
 * (prompts/interview_agent.md) calls log_intake_field, wired in the
 * ElevenLabs dashboard to POST /api/intake/{job_id}/voice-tool — the job_id
 * is passed in as a dynamic variable below so the tool call knows which job
 * to update.
 *
 * `dynamic-variables` is the documented widget attribute (a JSON string); the
 * job_id passed here is what the agent interpolates into its log_intake_field
 * tool call. Caveat: that tool is a *webhook*, so field-logging only reaches
 * this backend when WEBHOOK_BASE_URL is configured. Without it the widget can
 * still hold the voice conversation, but use the manual form to persist the
 * spec — it produces the identical JobSpec.
 */
export function VoiceIntakeWidget({ agentId, jobId }: { agentId: string | null; jobId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agentId) return;
    if (document.querySelector(`script[src="${WIDGET_SCRIPT_SRC}"]`)) return;
    const script = document.createElement("script");
    script.src = WIDGET_SCRIPT_SRC;
    script.async = true;
    document.head.appendChild(script);
  }, [agentId]);

  if (!agentId) {
    return (
      <Alert>
        <Mic className="mt-0.5" />
        <AlertTitle>Voice interview not configured</AlertTitle>
        <AlertDescription>
          Set <code>ELEVENLABS_INTERVIEW_AGENT_ID</code> on the backend to enable live voice intake. Use the form
          below in the meantime — it produces the exact same job spec.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div ref={containerRef} className="flex min-h-40 items-center justify-center rounded-lg border border-line bg-paper p-6">
      {(() => {
        const Widget = "elevenlabs-convai" as any;
        return (
          <Widget
            agent-id={agentId}
            dynamic-variables={JSON.stringify({ job_id: jobId })}
            action-text="Talk to the CallPilot intake assistant"
            start-call-text="Start voice interview"
            end-call-text="End interview"
          />
        );
      })()}
    </div>
  );
}
