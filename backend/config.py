"""
Environment configuration and validation.

CallPilot never fakes a working integration. Every route that needs a
provider checks the relevant helper below first and returns a 503 with the
specific missing variable names rather than silently falling back to
demo/simulated data.

Two call modes, selected by CALL_MODE (default "simulation"):

  simulation  — the Caller agent negotiates against each counterparty
                persona via ElevenLabs' agent simulation API. Genuine,
                unscripted agent-to-agent runs with real transcripts and
                real price movement, at zero telephony cost. Needs only
                OPENAI_API_KEY + ELEVENLABS_API_KEY + a created Caller agent.
                No Twilio, no counterparty phone numbers, no public webhook.

  telephony   — real outbound voice calls over Twilio/SIP. Adds a caller
                phone-number id and a public WEBHOOK_BASE_URL for the
                agent's log_quote tool. Demo-persona calls additionally need
                the three counterparty phone numbers; real-business calls
                need only a call list.
"""

from __future__ import annotations

import functools
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

import yaml

CONFIGS_DIR = Path(__file__).parent / "configs"
PROMPTS_DIR = Path(__file__).parent / "prompts"


def _load_dotenv() -> None:
    """Load backend/.env into the environment on import, so `uvicorn main:app`
    just works without the caller having to export the keys first. Only sets
    vars that aren't already in the environment (real env wins over the file)."""
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ and value:
            os.environ[key] = value


_load_dotenv()


class VerticalConfigError(RuntimeError):
    pass


def call_mode() -> str:
    """Current call mode. 'simulation' (default) or 'telephony'. Anything
    unrecognized falls back to simulation — the safe, no-cost default."""
    mode = os.environ.get("CALL_MODE", "simulation").strip().lower()
    return mode if mode in ("simulation", "telephony") else "simulation"


@functools.lru_cache(maxsize=8)
def load_vertical_config(vertical: str) -> Dict[str, Any]:
    """
    Loads configs/{vertical}.yaml — the single file that defines job-spec
    taxonomy, price benchmarks, red-flag rules, and negotiation levers for
    a vertical. Swapping verticals means adding a new YAML file here, not
    touching main.py/schema.py.
    """
    path = CONFIGS_DIR / f"{vertical}.yaml"
    if not path.exists():
        available = [p.stem for p in CONFIGS_DIR.glob("*.yaml")]
        raise VerticalConfigError(
            f"No config found for vertical '{vertical}'. Available: {available}"
        )
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


@dataclass(frozen=True)
class RequiredVar:
    name: str
    category: str
    description: str
    modes: tuple  # which call modes require this: ("simulation", "telephony") or a subset


# ── Variables required for the core loop, tagged by the call mode(s) that need them ──
CORE_VARS: List[RequiredVar] = [
    RequiredVar("OPENAI_API_KEY", "openai",
                "Document/photo extraction (vision) and the final plain-language recommendation.",
                ("simulation", "telephony")),
    RequiredVar("ELEVENLABS_API_KEY", "elevenlabs",
                "Runs agent simulations (simulation mode) and places/polls calls (telephony mode).",
                ("simulation", "telephony")),
    RequiredVar("ELEVENLABS_CALLER_AGENT_ID", "elevenlabs",
                "The Caller-role agent. Create it with `python scripts/provision_agents.py` "
                "or paste prompts/caller_agent.md into a new agent in the dashboard.",
                ("simulation", "telephony")),
    # Telephony-only:
    RequiredVar("ELEVENLABS_CALLER_PHONE_NUMBER_ID", "telephony",
                "The Twilio/SIP number (as registered in ElevenLabs) the Caller dials out from. "
                "Telephony mode only.",
                ("telephony",)),
]

# ── Optional across both modes ──
OPTIONAL_VARS: List[RequiredVar] = [
    RequiredVar("ELEVENLABS_INTERVIEW_AGENT_ID", "voice_intake",
                "Live voice-interview intake agent (prompts/interview_agent.md). "
                "Without it, the manual-form and document intake paths still work fully.",
                ("simulation", "telephony")),
    RequiredVar("TAVILY_API_KEY", "call_list",
                "Builds the real-world call list (business names + phone numbers) via Tavily web "
                "search. Without it (and without Google Places), enter the call list manually.",
                ("simulation", "telephony")),
    RequiredVar("GOOGLE_PLACES_API_KEY", "call_list",
                "Alternative call-list source via Google Places. Tavily is preferred; either works.",
                ("simulation", "telephony")),
    RequiredVar("WEBHOOK_BASE_URL", "webhooks",
                "Public URL for the agent's log_quote webhook (real-time quote capture on telephony). "
                "Optional: without it, quotes are still captured from the polled call transcript.",
                ("telephony",)),
    RequiredVar("COUNTERPARTY_TOUGH_NUMBER", "demo_personas",
                "Phone number for the Tough Negotiator demo agent — only for telephony demo-persona "
                "calls. Simulation mode drives this persona from prompts/counterparty_tough.md.",
                ("telephony",)),
    RequiredVar("COUNTERPARTY_STONEWALL_NUMBER", "demo_personas",
                "Phone number for the Stonewaller demo agent — telephony demo-persona calls only.",
                ("telephony",)),
    RequiredVar("COUNTERPARTY_HARDSELL_NUMBER", "demo_personas",
                "Phone number for the Hard-Sell Upseller demo agent — telephony demo-persona calls only.",
                ("telephony",)),
]


COUNTERPARTY_NUMBER_ENV = {
    "tough_negotiator": "COUNTERPARTY_TOUGH_NUMBER",
    "stonewaller": "COUNTERPARTY_STONEWALL_NUMBER",
    "hard_sell_upseller": "COUNTERPARTY_HARDSELL_NUMBER",
}


def resolve_counterparty_number(style: str) -> str | None:
    env_name = COUNTERPARTY_NUMBER_ENV.get(style)
    return os.environ.get(env_name) if env_name else None


def read_prompt(prompt_file: str) -> str:
    """Read a prompt template (relative to backend/) — used both to provision
    agents and to drive counterparty personas in simulation."""
    path = Path(__file__).parent / prompt_file
    if not path.exists():
        raise VerticalConfigError(f"Prompt file not found: {prompt_file}")
    return path.read_text(encoding="utf-8")


def load_counterparty_persona(vertical: str, style: str) -> Dict[str, Any]:
    """
    Resolve one counterparty persona for the simulation path: its system
    prompt text (from the .md file), the company name it answers as, and its
    phone-answer first message. Raises if the style isn't configured.
    """
    vconfig = load_vertical_config(vertical)
    styles = vconfig.get("counterparty_styles", {})
    meta = styles.get(style)
    if not meta:
        raise VerticalConfigError(
            f"No counterparty style '{style}' in {vertical}.yaml. Available: {list(styles)}"
        )
    return {
        "style": style,
        "company_name": meta.get("company_name", style.replace("_", " ").title()),
        "first_message": meta.get("first_message", "Hello?"),
        "description": meta.get("description", ""),
        "prompt_text": read_prompt(meta["prompt_file"]),
    }


def _required_for_mode(mode: str) -> List[RequiredVar]:
    return [v for v in CORE_VARS if mode in v.modes]


def missing_required(mode: str | None = None) -> List[RequiredVar]:
    mode = mode or call_mode()
    return [v for v in _required_for_mode(mode) if not os.environ.get(v.name)]


def config_status() -> dict:
    """Non-secret config status for GET /api/health and the frontend's
    blocking setup panel. Returns variable *names* only, never values."""
    mode = call_mode()
    missing_req = missing_required(mode)

    # Simulation readiness is a subset of telephony readiness — surface both so
    # the UI can say "simulation works now; telephony needs N more vars".
    sim_missing = missing_required("simulation")
    tel_missing = missing_required("telephony")

    categories: Dict[str, Any] = {}
    for v in CORE_VARS + OPTIONAL_VARS:
        is_required_here = mode in v.modes and v in CORE_VARS
        categories.setdefault(v.category, {"required": is_required_here, "missing": []})
        if is_required_here:
            categories[v.category]["required"] = True

    for v in CORE_VARS + OPTIONAL_VARS:
        if os.environ.get(v.name):
            continue
        cat = categories[v.category]
        cat["missing"].append({
            "name": v.name,
            "description": v.description,
            "needed_for": list(v.modes),
        })

    return {
        "call_mode": mode,
        "ready_for_calls": len(missing_req) == 0,
        "simulation_ready": len(sim_missing) == 0,
        "telephony_ready": len(tel_missing) == 0,
        "voice_intake_available": bool(os.environ.get("ELEVENLABS_INTERVIEW_AGENT_ID")),
        # Agent IDs are public (they ship in client-side widget embeds), so it's
        # safe to hand the interview agent id to the browser widget.
        "interview_agent_id": os.environ.get("ELEVENLABS_INTERVIEW_AGENT_ID"),
        "call_list_source": (
            "tavily" if os.environ.get("TAVILY_API_KEY")
            else "google_places" if os.environ.get("GOOGLE_PLACES_API_KEY")
            else "manual"
        ),
        "categories": categories,
        "missing_required_count": len(missing_req),
    }


def require_openai_config() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("Cannot use OpenAI features: OPENAI_API_KEY is not configured. See /api/health.")


def require_elevenlabs_config() -> None:
    if not os.environ.get("ELEVENLABS_API_KEY"):
        raise RuntimeError("Cannot reach ElevenLabs: ELEVENLABS_API_KEY is not configured. See /api/health.")


def require_simulation_config() -> None:
    """Raise if the simulation call path can't run. Needs the ElevenLabs key
    and a created Caller agent — nothing telephony-related."""
    missing = missing_required("simulation")
    if missing:
        names = ", ".join(v.name for v in missing)
        raise RuntimeError(
            f"Cannot run agent simulations: missing required configuration ({names}). "
            f"See /api/health for details on each."
        )


def require_calling_config() -> None:
    """Raise if real telephony can't run. Import-time-safe: callers catch and
    convert to HTTP 503."""
    missing = missing_required("telephony")
    if missing:
        names = ", ".join(v.name for v in missing)
        raise RuntimeError(
            f"Cannot place live calls: missing required configuration ({names}). "
            f"See /api/health for details on each."
        )
