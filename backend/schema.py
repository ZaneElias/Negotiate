"""
CallPilot core schema.

Vertical-agnostic on purpose: JobSpec and Quote both carry a free-form
`fields: Dict[str, Any]` bucket whose *shape* is defined by the active
vertical config (configs/moving.yaml, ...), not by this file. Swapping
verticals means swapping the config, not this schema.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


# ──────────────────────────────────────────────────────────────────────────
# Job spec (Estimator output)
# ──────────────────────────────────────────────────────────────────────────

class IntakeSource(str, Enum):
    VOICE_INTERVIEW = "voice_interview"
    DOCUMENT = "document"
    MANUAL_FORM = "manual_form"


class JobSpec(BaseModel):
    """
    The single structured spec, produced by voice interview and/or document
    intake (or the manual form fallback), confirmed by the user, then reused
    verbatim on every outbound call.
    """
    job_id: str = Field(default_factory=lambda: new_id("job"))
    vertical: str = "moving"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Vertical-specific structured data — shape validated against the active
    # vertical config's job_spec_schema at confirm-time.
    fields: Dict[str, Any] = Field(default_factory=dict)

    # Provenance: which intake path contributed which top-level field, so the
    # confirmation screen can show "from your voice interview" vs "from the
    # photo you uploaded" vs "you typed this".
    field_sources: Dict[str, IntakeSource] = Field(default_factory=dict)

    # Free-text extraction notes surfaced to the user for review (e.g. "could
    # not confirm whether there's an elevator — please check").
    needs_review: List[str] = Field(default_factory=list)

    confirmed: bool = False
    confirmed_at: Optional[datetime] = None

    def as_call_context(self) -> Dict[str, Any]:
        """
        The exact, frozen dict handed to every outbound call agent as
        dynamic variables. Same dict, every call — that's what makes quotes
        comparable. Must not be mutated after confirmation.

        Values are coerced to what ElevenLabs dynamic-variable templating
        renders cleanly: lists → comma-joined strings, None → "not specified".
        Numbers and booleans pass through. This keeps {{large_items}} etc.
        readable in the agent's prompt instead of leaking JSON.
        """
        if not self.confirmed:
            raise ValueError("JobSpec must be confirmed before it can be used on calls")

        def coerce(value: Any) -> Any:
            if value is None:
                return "not specified"
            if isinstance(value, (list, tuple)):
                return ", ".join(str(v) for v in value) if value else "none"
            return value

        ctx = {"job_id": self.job_id, "vertical": self.vertical}
        for key, value in self.fields.items():
            ctx[key] = coerce(value)
        return ctx


class IntakeUpdateRequest(BaseModel):
    """Body for POST /api/intake/{job_id}/update — the manual-form fallback
    and the target of voice-tool / document-extraction merges alike."""
    fields: Dict[str, Any] = Field(default_factory=dict)
    source: IntakeSource = IntakeSource.MANUAL_FORM

    @field_validator("fields")
    @classmethod
    def _no_empty_keys(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        return {k: val for k, val in v.items() if k and val is not None and val != ""}


# ──────────────────────────────────────────────────────────────────────────
# Calls / Quotes (Caller output)
# ──────────────────────────────────────────────────────────────────────────

class CallStatus(str, Enum):
    QUEUED = "queued"
    DIALING = "dialing"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    NO_ANSWER = "no_answer"


class CallOutcome(str, Enum):
    QUOTE_GIVEN = "quote_given"
    CALLBACK_PROMISED = "callback_promised"
    DECLINED = "declined"
    NO_PRICES_OVER_PHONE = "no_prices_over_phone"
    HANG_UP = "hang_up"
    UNREACHABLE = "unreachable"


class NegotiationStyle(str, Enum):
    """Counterparty posture. Used to pick a counterparty-agent prompt in
    simulated mode and to label the persona in the dashboard/report."""
    TOUGH_NEGOTIATOR = "tough_negotiator"
    STONEWALLER = "stonewaller"
    HARD_SELL_UPSELLER = "hard_sell_upseller"
    STRAIGHT_SHOOTER = "straight_shooter"


class LineItem(BaseModel):
    label: str
    amount: float
    is_optional_or_conditional: bool = False
    notes: Optional[str] = None


class Quote(BaseModel):
    quote_id: str = Field(default_factory=lambda: new_id("quote"))
    job_id: str
    call_id: str
    company_name: str
    phone_number: str

    base_price: Optional[float] = None
    line_items: List[LineItem] = Field(default_factory=list)
    total_price: Optional[float] = None
    currency: str = "USD"

    negotiation_style_label: Optional[NegotiationStyle] = None
    outcome: CallOutcome
    callback_time: Optional[datetime] = None
    binding: bool = False  # true only if the counterparty explicitly confirmed the number is firm

    is_red_flag: bool = False
    red_flag_reason: Optional[str] = None
    red_flag_pct_below_market: Optional[float] = None  # exact % below the scaled benchmark median, when that rule fired

    pre_negotiation_total: Optional[float] = None
    post_negotiation_total: Optional[float] = None
    negotiation_notes: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class TranscriptTurn(BaseModel):
    speaker: str  # "agent" | "counterparty"
    text: str
    timestamp_s: float = 0.0


class CallRecord(BaseModel):
    call_id: str = Field(default_factory=lambda: new_id("call"))
    job_id: str
    company_name: str
    phone_number: str
    negotiation_style_label: Optional[NegotiationStyle] = None
    status: CallStatus = CallStatus.QUEUED
    elevenlabs_conversation_id: Optional[str] = None
    twilio_call_sid: Optional[str] = None
    transcript: List[TranscriptTurn] = Field(default_factory=list)
    recording_url: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    quote_id: Optional[str] = None
    is_negotiation_callback: bool = False
    competing_quote_used_as_leverage: Optional[str] = None
    negotiating_quote_id: Optional[str] = None  # the earlier quote this callback is renegotiating
    mode: str = "telephony"  # "simulation" | "telephony" — how this call was placed
    error: Optional[str] = None

    # idempotency: webhook event ids already applied to this call, so
    # provider retries don't duplicate a quote or transcript turn
    applied_webhook_events: List[str] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────
# Report (Closer output)
# ──────────────────────────────────────────────────────────────────────────

class RankedQuote(BaseModel):
    rank: int
    quote: Quote
    call: CallRecord
    score_notes: str


class Report(BaseModel):
    job_id: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    ranked_quotes: List[RankedQuote]
    recommended_quote_id: Optional[str]
    plain_language_summary: str
    market_spread: Dict[str, float]
    red_flags: List[str]
