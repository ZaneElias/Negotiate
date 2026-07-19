#!/usr/bin/env python
"""
CallPilot — one-command ElevenLabs agent provisioning.

Creates everything the dashboard would otherwise make you click together:

  • two webhook tools — log_quote and log_intake_field — pointed at your
    WEBHOOK_BASE_URL (used by real telephony calls; harmlessly mocked in
    simulation mode).
  • the Caller agent (prompts/caller_agent.md), with log_quote attached.
  • the Estimator interview agent (prompts/interview_agent.md), with
    log_intake_field attached.  [--interview / --no-interview]
  • the three counterparty demo agents (prompts/counterparty_*.md).  Only
    needed for the *telephony* demo-persona path — simulation drives these
    personas without a created agent, so this is opt-in.  [--counterparties]

Idempotent: re-running reuses tools/agents that already exist by name instead
of creating duplicates.  At the end it prints the exact env-var lines to paste
into backend/.env.

Usage:
    python scripts/provision_agents.py                 # tools + caller + interview
    python scripts/provision_agents.py --counterparties # also the 3 telephony personas
    python scripts/provision_agents.py --dry-run        # show what it would do

Requires ELEVENLABS_API_KEY (and, for real telephony, WEBHOOK_BASE_URL) in the
environment or backend/.env.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import yaml

BACKEND_DIR = Path(__file__).resolve().parent.parent
BASE_URL = "https://api.elevenlabs.io/v1/convai"

CALLER_AGENT_NAME = "CallPilot Caller"
INTERVIEW_AGENT_NAME = "CallPilot Estimator (Interview)"
LOG_QUOTE_TOOL = "log_quote"
LOG_INTAKE_TOOL = "log_intake_field"


# ── tiny .env loader (no python-dotenv dependency) ──────────────────────────

def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ and value:
            os.environ[key] = value


# ── prompt cleaning ─────────────────────────────────────────────────────────

_META_PREFIXES = (
    "Paste this", "Use this as", "Register its number", "Set `ELEVENLABS",
    "Wire the", "This is the voice-interview", "This same agent",
)


def clean_prompt(md: str) -> str:
    """Strip the human-facing 'paste this into the dashboard' preamble so only
    the agent's actual instructions become its system prompt. Keeps the H1
    title for context and starts the body at the first '## ' section."""
    if "\n---\n" in md:
        md = md.split("\n---\n", 1)[1]
    md = md.strip()
    lines = md.splitlines()
    title = lines[0] if lines and lines[0].startswith("# ") else ""

    idx = md.find("\n## ")
    if md.startswith("## "):
        body = md
    elif idx != -1:
        body = md[idx:].strip()
    else:
        # No section headers — fall back to dropping meta-prefixed lines.
        body = "\n".join(
            l for l in lines if not any(l.strip().startswith(p) for p in _META_PREFIXES)
        ).strip()
        return body

    return f"{title}\n\n{body}".strip() if title and not body.startswith("# ") else body


def read_prompt(rel: str) -> str:
    return clean_prompt((BACKEND_DIR / rel).read_text(encoding="utf-8"))


# ── ElevenLabs REST helpers ─────────────────────────────────────────────────

class EL:
    def __init__(self, api_key: str, dry_run: bool = False):
        self.h = {"xi-api-key": api_key, "Content-Type": "application/json"}
        self.dry_run = dry_run
        self.client = httpx.Client(timeout=40.0)

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        r = self.client.get(f"{BASE_URL}{path}", headers=self.h, params=params)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        r = self.client.post(f"{BASE_URL}{path}", headers=self.h, json=body)
        if r.status_code >= 400:
            raise RuntimeError(f"POST {path} → {r.status_code}: {r.text[:500]}")
        return r.json()

    # tools
    def find_tool(self, name: str) -> Optional[str]:
        data = self._get("/tools")
        items = data.get("tools", data) if isinstance(data, dict) else data
        for t in (items or []):
            cfg = t.get("tool_config", t)
            if cfg.get("name") == name:
                return t.get("id") or t.get("tool_id")
        return None

    def create_tool(self, tool_config: Dict[str, Any]) -> str:
        name = tool_config["name"]
        if self.dry_run:
            print(f"  ↳ [dry-run] would create tool '{name}'")
            return f"<{name}-id>"
        existing = self.find_tool(name)
        if existing:
            print(f"  ↳ tool '{name}' already exists ({existing}) — reusing")
            return existing
        resp = self._post("/tools", {"tool_config": tool_config})
        tid = resp.get("id") or resp.get("tool_id")
        print(f"  ↳ created tool '{name}' → {tid}")
        return tid

    # agents
    def find_agent(self, name: str) -> Optional[str]:
        data = self._get("/agents")
        items = data.get("agents", data) if isinstance(data, dict) else data
        for a in (items or []):
            if a.get("name") == name:
                return a.get("agent_id")
        return None

    def create_agent(self, name: str, system_prompt: str, first_message: str,
                     llm: str, tool_ids: List[str]) -> str:
        if self.dry_run:
            print(f"  ↳ [dry-run] would create agent '{name}' (llm={llm}, tools={tool_ids})")
            return f"<{name}-id>"
        existing = self.find_agent(name)
        if existing:
            print(f"  ↳ agent '{name}' already exists ({existing}) — reusing")
            return existing
        body = {
            "name": name,
            "conversation_config": {
                "agent": {
                    "first_message": first_message,
                    "prompt": {
                        "prompt": system_prompt,
                        "llm": llm,
                        "tool_ids": tool_ids,
                    },
                },
            },
        }
        resp = self._post("/agents/create", body)
        aid = resp.get("agent_id")
        print(f"  ↳ created agent '{name}' → {aid}")
        return aid


# ── tool schemas ────────────────────────────────────────────────────────────

def log_quote_tool(webhook_base: str) -> Dict[str, Any]:
    return {
        "type": "webhook",
        "name": LOG_QUOTE_TOOL,
        "description": (
            "Log the structured outcome of this call. Call exactly once, right before ending the call."
        ),
        "response_timeout_secs": 20,
        "api_schema": {
            "url": f"{webhook_base}/api/calls/{{{{job_id}}}}/{{{{call_id}}}}/webhook",
            "method": "POST",
            "path_params_schema": {
                "job_id": {"type": "string", "dynamic_variable": "job_id"},
                "call_id": {"type": "string", "dynamic_variable": "call_id"},
            },
            "request_body_schema": {
                "type": "object",
                "description": "Structured call outcome",
                "properties": {
                    "outcome": {"type": "string",
                                "description": "one of quote_given, callback_promised, declined, no_prices_over_phone, hang_up"},
                    "company_name": {"type": "string", "description": "the company you called"},
                    "base_price": {"type": "number", "description": "base labor+truck cost, if given"},
                    "line_items": {
                        "type": "array",
                        "description": "every fee named: base, fuel, stairs, packing, insurance, etc.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string", "description": "fee name"},
                                "amount": {"type": "number", "description": "fee amount in USD"},
                                "is_optional_or_conditional": {"type": "boolean", "description": "true if conditional"},
                            },
                            "required": ["label", "amount"],
                        },
                    },
                    "total_price": {"type": "number", "description": "grand total if stated"},
                    "binding": {"type": "boolean",
                                "description": "true ONLY if the company confirmed the number is firm"},
                    "callback_time": {"type": "string", "description": "ISO datetime or best-effort text if callback_promised"},
                    "notes": {"type": "string", "description": "in negotiation mode, what changed and why"},
                },
                "required": ["outcome", "company_name"],
            },
        },
    }


def log_intake_field_tool(webhook_base: str) -> Dict[str, Any]:
    return {
        "type": "webhook",
        "name": LOG_INTAKE_TOOL,
        "description": "Log one confirmed job-spec field as soon as it's gathered. Call once per field.",
        "response_timeout_secs": 20,
        "api_schema": {
            "url": f"{webhook_base}/api/intake/{{{{job_id}}}}/voice-tool",
            "method": "POST",
            "path_params_schema": {
                "job_id": {"type": "string", "dynamic_variable": "job_id"},
            },
            "request_body_schema": {
                "type": "object",
                "description": "One job-spec field",
                "properties": {
                    "field_name": {"type": "string", "description": "the job-spec field name"},
                    "value": {"type": "string", "description": "the field value as stated by the customer"},
                    "confidence": {"type": "string", "description": "confirmed or uncertain"},
                },
                "required": ["field_name", "value", "confidence"],
            },
        },
    }


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Provision CallPilot's ElevenLabs agents and tools.")
    parser.add_argument("--counterparties", action="store_true",
                        help="also create the 3 telephony demo-persona agents (not needed for simulation)")
    parser.add_argument("--no-interview", action="store_true", help="skip the voice interview agent")
    parser.add_argument("--dry-run", action="store_true", help="print what would happen without creating anything")
    parser.add_argument("--llm", default=os.environ.get("ELEVENLABS_AGENT_LLM", "gpt-4.1"),
                        help="agent LLM (default gpt-4.1; must be enabled on your ElevenLabs plan)")
    args = parser.parse_args()

    load_dotenv(BACKEND_DIR / ".env")

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("ERROR: ELEVENLABS_API_KEY not set (put it in backend/.env or the environment).", file=sys.stderr)
        return 1

    webhook_base = os.environ.get("WEBHOOK_BASE_URL", "").rstrip("/")
    if not webhook_base:
        webhook_base = "https://REPLACE-WITH-YOUR-PUBLIC-URL.example.com"
        print("NOTE: WEBHOOK_BASE_URL not set. Tools will be created with a placeholder URL — fine for")
        print("      simulation (tool calls are mocked), but re-run after setting it for real telephony.\n")

    el = EL(api_key, dry_run=args.dry_run)
    outputs: Dict[str, str] = {}

    print("1) Webhook tools")
    quote_tool_id = el.create_tool(log_quote_tool(webhook_base))
    intake_tool_id = el.create_tool(log_intake_field_tool(webhook_base))

    print("\n2) Caller agent")
    caller_first = ("Hi — I'm an AI assistant calling on behalf of a customer who's planning a move, "
                    "to gather a quote. Is now a good time?")
    caller_id = el.create_agent(
        CALLER_AGENT_NAME, read_prompt("prompts/caller_agent.md"),
        caller_first, args.llm, [quote_tool_id],
    )
    outputs["ELEVENLABS_CALLER_AGENT_ID"] = caller_id

    if not args.no_interview:
        print("\n3) Estimator interview agent")
        interview_first = ("Hi, I'm CallPilot's intake assistant — I'll ask a few questions about your move "
                           "so I can get you accurate quotes. This takes about three minutes. Ready?")
        interview_id = el.create_agent(
            INTERVIEW_AGENT_NAME, read_prompt("prompts/interview_agent.md"),
            interview_first, args.llm, [intake_tool_id],
        )
        outputs["ELEVENLABS_INTERVIEW_AGENT_ID"] = interview_id

    if args.counterparties:
        print("\n4) Telephony demo-persona agents")
        vconfig = yaml.safe_load((BACKEND_DIR / "configs" / "moving.yaml").read_text(encoding="utf-8"))
        for style, meta in vconfig.get("counterparty_styles", {}).items():
            name = f"CallPilot Counterparty — {meta.get('company_name', style)}"
            aid = el.create_agent(
                name, read_prompt(meta["prompt_file"]),
                meta.get("first_message", "Hello?"), args.llm, [],
            )
            print(f"     ({style} → connect a phone number to this agent, then set its COUNTERPARTY_*_NUMBER)")

    print("\n" + "=" * 68)
    print("Done. Paste these into backend/.env:\n")
    for k, v in outputs.items():
        print(f"{k}={v}")
    print("\n(ELEVENLABS_API_KEY, OPENAI_API_KEY, TAVILY_API_KEY you already have.)")
    if webhook_base.startswith("https://REPLACE"):
        print("\nReminder: set WEBHOOK_BASE_URL and re-run before doing REAL telephony calls.")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
