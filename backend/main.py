"""
CallPilot backend — FastAPI service.

Routed behind Vercel's /api prefix (see root vercel.json); Vercel strips the
prefix before forwarding here, so routes below are declared without it in
mind but registered under /api via the `api` router prefix at the bottom.

State is process-memory (JOBS / CALLS / QUOTES dicts) — the same
lightweight-hackathon tradeoff as the original build notes, made explicit:
a restart loses everything, and the frontend must treat that as a clear
"session expired" case rather than silently misbehaving.

This module never fakes provider output. Every route that depends on
OpenAI/ElevenLabs/Google Places config checks for it first and returns a
structured 503 rather than falling back to synthesized data.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from collections import defaultdict, deque

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import config
from schema import (
    CallOutcome,
    CallRecord,
    CallStatus,
    IntakeSource,
    IntakeUpdateRequest,
    JobSpec,
    LineItem,
    NegotiationStyle,
    Quote,
    RankedQuote,
    Report,
    TranscriptTurn,
    new_id,
)
from services import call_list as call_list_service
from services import elevenlabs_client
from services import openai_client

logger = logging.getLogger("callpilot")

app = FastAPI(title="CallPilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────────────────────────────────
# In-memory state
# ──────────────────────────────────────────────────────────────────────────

JOBS: Dict[str, JobSpec] = {}
CALLS: Dict[str, List[CallRecord]] = {}   # job_id -> [CallRecord]
QUOTES: Dict[str, List[Quote]] = {}       # job_id -> [Quote]
AUDIO_CACHE: Dict[str, bytes] = {}        # call_id -> synthesized MP3 (TTS replay); one synthesis per call
REPORT_SUMMARY_CACHE: Dict[str, str] = {} # job_id -> last generated plain-language summary (for spoken replay)
_STATE_LOCK = asyncio.Lock()

MAX_UPLOAD_BYTES = 12 * 1024 * 1024  # 12 MB
MAX_STR_LEN = 2000  # cap any free-text field the intake accepts
MAX_ARRAY_ITEMS = 50


# ── Security hardening ─────────────────────────────────────────────────────
# In-memory per-IP rate limiting for the expensive / paid-provider endpoints,
# so a bot (or a runaway client) can't burn OpenAI/ElevenLabs credits or spam
# uploads. Buckets are sliding windows; state is process-memory like the rest.
_RATE_BUCKETS: Dict[str, deque] = defaultdict(deque)


def _rate_rule(method: str, path: str):
    """(bucket_name, max_requests, window_secs) for a request, or None to skip."""
    if method != "POST":
        return None
    if path.endswith("/document"):
        return ("upload", 12, 60)
    if "/simulate" in path or path.endswith("/start"):
        return ("calls", 10, 60)
    if "/negotiate" in path:
        return ("negotiate", 10, 60)
    if path == "/intake":
        return ("intake", 40, 60)
    return None


@app.middleware("http")
async def _rate_limit_middleware(request: Request, call_next):
    rule = _rate_rule(request.method, request.url.path)
    if rule:
        bucket, limit, window = rule
        ip = request.client.host if request.client else "unknown"
        key = f"{ip}:{bucket}"
        now = time.time()
        dq = _RATE_BUCKETS[key]
        while dq and dq[0] < now - window:
            dq.popleft()
        if len(dq) >= limit:
            logger.warning("rate limit hit: ip=%s bucket=%s path=%s", ip, bucket, request.url.path)
            return JSONResponse(
                status_code=429,
                content={"detail": {"error": "rate_limited",
                                    "message": "Too many requests — please slow down and try again shortly."}},
            )
        dq.append(now)
    return await call_next(request)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """Never leak a stack trace or internal detail to the client. Real error
    goes to the server log; the caller gets a generic message."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": {"error": "internal_error", "message": "Something went wrong. Please try again."}},
    )


def _sanitize_fields(vertical: str, fields: Dict[str, Any]) -> Dict[str, Any]:
    """Accept only fields defined by the active vertical's schema, coerced and
    bounded by declared type. Unknown keys are dropped (unsafe-form defense),
    strings are length-capped, numbers are finite and clamped, arrays are
    size-capped. Validates on the server regardless of any client checks."""
    try:
        schema = config.load_vertical_config(vertical)["job_spec_schema"]
    except Exception:
        return {}
    clean: Dict[str, Any] = {}
    for key, value in fields.items():
        spec = schema.get(key)
        if spec is None or value is None:
            continue  # drop anything not in the schema
        t = spec.get("type")
        if t == "string":
            clean[key] = str(value)[:MAX_STR_LEN]
        elif t == "number":
            try:
                n = float(value)
            except (TypeError, ValueError):
                continue
            if n != n or n in (float("inf"), float("-inf")):
                continue
            clean[key] = max(0.0, min(n, 1_000_000.0))
        elif t == "boolean":
            clean[key] = bool(value)
        elif t == "array":
            if isinstance(value, (list, tuple)):
                clean[key] = [str(x)[:200] for x in list(value)[:MAX_ARRAY_ITEMS]]
        else:
            clean[key] = str(value)[:MAX_STR_LEN]
    return clean


_IMAGE_MAGIC_OK = (
    lambda b: b[:8] == b"\x89PNG\r\n\x1a\n"
    or b[:3] == b"\xff\xd8\xff"
    or b[:6] in (b"GIF87a", b"GIF89a")
    or (b[:4] == b"RIFF" and b[8:12] == b"WEBP")
)


def _job_or_404(job_id: str) -> JobSpec:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "job_not_found",
                "message": (
                    f"No job with id '{job_id}'. Backend state is in-memory and does not "
                    f"survive a server restart — if this job existed before a deploy/restart, "
                    f"start a new one."
                ),
            },
        )
    return job


def _call_or_404(job_id: str, call_id: str) -> CallRecord:
    for c in CALLS.get(job_id, []):
        if c.call_id == call_id:
            return c
    raise HTTPException(status_code=404, detail={"error": "call_not_found", "call_id": call_id})


def _idempotency_key(payload: Dict[str, Any], provided: Optional[str]) -> str:
    if provided:
        return provided
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:24]


# ──────────────────────────────────────────────────────────────────────────
# Health / config
# ──────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> Dict[str, Any]:
    """Non-secret config status. The frontend's blocking setup panel reads this."""
    status = config.config_status()
    status["jobs_in_memory"] = len(JOBS)
    return status


# ──────────────────────────────────────────────────────────────────────────
# Estimator — intake
# ──────────────────────────────────────────────────────────────────────────

class IntakeCreateRequest(BaseModel):
    vertical: str = "moving"


@app.post("/intake")
def create_intake(body: IntakeCreateRequest) -> JobSpec:
    try:
        vconfig = config.load_vertical_config(body.vertical)
    except config.VerticalConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    job = JobSpec(vertical=vconfig["vertical"])
    JOBS[job.job_id] = job
    CALLS[job.job_id] = []
    QUOTES[job.job_id] = []
    return job


@app.get("/intake/{job_id}")
def get_intake(job_id: str) -> JobSpec:
    return _job_or_404(job_id)


@app.get("/intake/{job_id}/schema")
def get_intake_schema(job_id: str) -> Dict[str, Any]:
    """The active vertical's job_spec_schema, for the frontend to render the
    manual-form fallback and the confirmation/review screen."""
    job = _job_or_404(job_id)
    vconfig = config.load_vertical_config(job.vertical)
    return vconfig["job_spec_schema"]


def _merge_fields(job: JobSpec, fields: Dict[str, Any], source: IntakeSource, confidence: str = "confirmed") -> None:
    fields = _sanitize_fields(job.vertical, fields)  # server-side validation, every intake path
    for key, value in fields.items():
        job.fields[key] = value
        job.field_sources[key] = source
    job.updated_at = datetime.utcnow()
    if confidence == "uncertain":
        for key in fields:
            note = f"unconfirmed: {key}"
            if note not in job.needs_review:
                job.needs_review.append(note)


@app.post("/intake/{job_id}/update")
def update_intake(job_id: str, body: IntakeUpdateRequest) -> JobSpec:
    """Direct form-based intake update — the manual-form fallback so the
    frontend can complete a job even without the ElevenLabs interview agent
    configured, and the same path document extraction results are merged
    through."""
    job = _job_or_404(job_id)
    if job.confirmed:
        raise HTTPException(
            status_code=409,
            detail={"error": "already_confirmed", "message": "This job spec is confirmed and frozen. Start a new job to change it."},
        )
    _merge_fields(job, body.fields, body.source)
    return job


class VoiceToolWebhookBody(BaseModel):
    field_name: str
    value: Any
    confidence: str = "confirmed"


@app.post("/intake/{job_id}/voice-tool")
def intake_voice_tool_webhook(job_id: str, body: VoiceToolWebhookBody) -> Dict[str, Any]:
    """Target for the interview agent's `log_intake_field` tool
    (prompts/interview_agent.md). Called once per field as the interview
    progresses."""
    job = _job_or_404(job_id)
    if job.confirmed:
        raise HTTPException(status_code=409, detail={"error": "already_confirmed"})
    _merge_fields(job, {body.field_name: body.value}, IntakeSource.VOICE_INTERVIEW, body.confidence)
    return {"status": "ok", "job_id": job_id, "field_name": body.field_name}


@app.post("/intake/{job_id}/document")
async def intake_document(job_id: str, file: UploadFile = File(...)) -> JobSpec:
    """Document/photo intake — vision-extracted into the same JobSpec.fields
    shape as the voice interview."""
    job = _job_or_404(job_id)
    if job.confirmed:
        raise HTTPException(status_code=409, detail={"error": "already_confirmed"})

    mime_type = file.content_type or ""
    if mime_type not in openai_client.SUPPORTED_IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail={
                "error": "unsupported_media_type",
                "message": f"'{mime_type}' not supported. Upload PNG/JPEG/WEBP/GIF. Rasterize PDF pages first.",
                "supported": sorted(openai_client.SUPPORTED_IMAGE_MIME_TYPES),
            },
        )

    try:
        config.require_openai_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error": "openai_not_configured", "message": str(exc)}) from exc

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail={"error": "file_too_large", "max_bytes": MAX_UPLOAD_BYTES})
    await file.close()

    # Don't trust the client-supplied Content-Type — verify the bytes really are
    # an image before spending an OpenAI vision call on them.
    if not _IMAGE_MAGIC_OK(raw):
        raise HTTPException(
            status_code=415,
            detail={"error": "not_an_image",
                    "message": "That file isn't a valid PNG/JPEG/WEBP/GIF image. Upload an actual image."},
        )

    vconfig = config.load_vertical_config(job.vertical)
    try:
        result = await openai_client.extract_job_spec_from_document(
            file_bytes=raw,
            mime_type=mime_type,
            vertical_schema=vconfig["job_spec_schema"],
            vertical_name=vconfig["display_name"],
        )
    except openai_client.OpenAIClientError as exc:
        raise HTTPException(status_code=502, detail={"error": "extraction_failed", "message": str(exc)}) from exc
    finally:
        del raw  # nothing persisted to disk in the first place; explicit for clarity

    _merge_fields(job, result.get("fields", {}), IntakeSource.DOCUMENT)
    for note in result.get("needs_review", []):
        if note not in job.needs_review:
            job.needs_review.append(note)
    return job


@app.post("/intake/{job_id}/confirm")
def confirm_intake(job_id: str) -> JobSpec:
    job = _job_or_404(job_id)
    if job.confirmed:
        return job

    vconfig = config.load_vertical_config(job.vertical)
    missing = [
        name for name, spec in vconfig["job_spec_schema"].items()
        if spec.get("required") and job.fields.get(name) in (None, "", [])
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "incomplete_job_spec",
                "message": "Required fields missing before this job spec can be confirmed and used on calls.",
                "missing_fields": missing,
            },
        )

    job.confirmed = True
    job.confirmed_at = datetime.utcnow()
    return job


# ──────────────────────────────────────────────────────────────────────────
# Call list sourcing (Google Places)
# ──────────────────────────────────────────────────────────────────────────

@app.get("/call-list/search")
async def search_call_list(category: str, location: str, max_results: int = 8) -> List[Dict[str, Any]]:
    try:
        return await call_list_service.find_businesses(category=category, location_text=location, max_results=max_results)
    except call_list_service.CallListError as exc:
        raise HTTPException(status_code=503, detail={"error": "call_list_unavailable", "message": str(exc)}) from exc


# ──────────────────────────────────────────────────────────────────────────
# Caller — placing calls
# ──────────────────────────────────────────────────────────────────────────

class CallTarget(BaseModel):
    company_name: str
    phone_number: Optional[str] = None  # required unless negotiation_style_label matches a configured demo counterparty
    negotiation_style_label: Optional[NegotiationStyle] = None


class CallStartRequest(BaseModel):
    targets: List[CallTarget] = Field(default_factory=list)


@app.get("/calls/counterparty-roster")
def counterparty_roster() -> List[Dict[str, Any]]:
    """Non-secret roster of the built demo counterparty personas — names and
    descriptions only, never the phone numbers. The frontend uses this to
    offer a one-click 'call all three personas' demo path; phone numbers are
    resolved server-side in start_calls."""
    vconfig = config.load_vertical_config("moving")
    mode = config.call_mode()
    roster = []
    for style, meta in vconfig["counterparty_styles"].items():
        # In simulation the persona is driven from its prompt file — always
        # available. In telephony it needs a registered phone number.
        configured = True if mode == "simulation" else (config.resolve_counterparty_number(style) is not None)
        roster.append({
            "style": style,
            "description": meta["description"],
            "company_name": meta.get("company_name"),
            "configured": configured,
        })
    return roster


@app.post("/calls/{job_id}/start")
async def start_calls(job_id: str, body: CallStartRequest) -> List[CallRecord]:
    job = _job_or_404(job_id)
    if not job.confirmed:
        raise HTTPException(
            status_code=409,
            detail={"error": "job_not_confirmed", "message": "Confirm the job spec before placing calls."},
        )
    if len(body.targets) < 3:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "insufficient_targets",
                "message": "The challenge requires calls against at least three distinct negotiation styles.",
            },
        )
    try:
        config.require_calling_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error": "calling_not_configured", "message": str(exc)}) from exc

    # Resolve phone numbers for demo-persona targets that omitted one.
    resolved_targets: List[CallTarget] = []
    for t in body.targets:
        phone = t.phone_number
        if not phone and t.negotiation_style_label:
            phone = config.resolve_counterparty_number(t.negotiation_style_label.value)
        if not phone:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "missing_phone_number",
                    "message": f"No phone number for target '{t.company_name}' and no configured demo counterparty for its style.",
                },
            )
        resolved_targets.append(CallTarget(company_name=t.company_name, phone_number=phone, negotiation_style_label=t.negotiation_style_label))
    body = CallStartRequest(targets=resolved_targets)

    agent_id = os.environ["ELEVENLABS_CALLER_AGENT_ID"]
    phone_number_id = os.environ["ELEVENLABS_CALLER_PHONE_NUMBER_ID"]
    call_context = job.as_call_context()

    new_records: List[CallRecord] = []
    for target in body.targets:
        record = CallRecord(
            job_id=job_id,
            company_name=target.company_name,
            phone_number=target.phone_number,
            negotiation_style_label=target.negotiation_style_label,
            status=CallStatus.DIALING,
            mode="telephony",
        )
        try:
            result = await asyncio.to_thread(
                elevenlabs_client.place_outbound_call,
                agent_id=agent_id,
                agent_phone_number_id=phone_number_id,
                to_number=target.phone_number,
                dynamic_variables={**call_context, "call_id": record.call_id},
            )
            record.elevenlabs_conversation_id = result["conversation_id"]
            record.twilio_call_sid = result.get("call_sid")
            record.status = CallStatus.IN_PROGRESS
            record.started_at = datetime.utcnow()
        except elevenlabs_client.ElevenLabsClientError as exc:
            record.status = CallStatus.FAILED
            record.error = str(exc)
        new_records.append(record)

    async with _STATE_LOCK:
        CALLS[job_id].extend(new_records)
    return new_records


@app.get("/calls/{job_id}")
async def list_calls(job_id: str, refresh: bool = True) -> List[CallRecord]:
    """Polling endpoint for the calls dashboard. When refresh=true (default),
    pulls latest status/transcript from ElevenLabs for any call still in
    progress before returning."""
    _job_or_404(job_id)
    records = CALLS.get(job_id, [])

    if refresh:
        for record in records:
            if record.status not in (CallStatus.IN_PROGRESS, CallStatus.DIALING):
                continue
            if not record.elevenlabs_conversation_id:
                continue
            try:
                payload = await elevenlabs_client.get_conversation(record.elevenlabs_conversation_id)
            except elevenlabs_client.ElevenLabsClientError:
                continue  # transient — leave status as-is, frontend will retry on next poll

            provider_status = payload.get("status")
            if provider_status in ("done", "ended", "completed"):
                record.status = CallStatus.COMPLETED
                record.ended_at = datetime.utcnow()
                # Capture the quote straight from the transcript's log_quote tool
                # call, so a real telephony call works even without a public
                # WEBHOOK_BASE_URL (the webhook stays a nice-to-have, not required).
                if record.quote_id is None:
                    logged = elevenlabs_client.extract_logged_quote_from_conversation(payload)
                    if logged:
                        if record.is_negotiation_callback:
                            await _apply_negotiation_result(job_id, record, logged)
                        else:
                            await _apply_first_pass_quote(job_id, record, logged)
            elif provider_status in ("failed", "error"):
                record.status = CallStatus.FAILED
                record.error = payload.get("error") or "Call failed at provider."

            turns = elevenlabs_client.extract_transcript_turns(payload)
            if turns:
                record.transcript = [TranscriptTurn(**t) for t in turns]
            if payload.get("has_audio"):
                record.recording_url = elevenlabs_client.get_recording_url(record.elevenlabs_conversation_id)

    return records


class QuoteWebhookBody(BaseModel):
    outcome: CallOutcome
    company_name: str
    base_price: Optional[float] = None
    line_items: List[LineItem] = Field(default_factory=list)
    total_price: Optional[float] = None
    binding: bool = False
    callback_time: Optional[str] = None
    notes: Optional[str] = None
    event_id: Optional[str] = None  # for idempotency; derived if absent


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None  # counterparty gave a fuzzy time like "this afternoon" — kept in notes, not parsed


def _find_original_quote(job_id: str, call: CallRecord) -> Optional[Quote]:
    """The earlier quote a negotiation callback is renegotiating. Prefers the
    explicit link, then phone number, then company name — never matches the
    callback's own freshly-created quote."""
    quotes = QUOTES.get(job_id, [])
    if call.negotiating_quote_id:
        for q in quotes:
            if q.quote_id == call.negotiating_quote_id:
                return q
    for q in quotes:
        if q.quote_id == call.quote_id:
            continue
        if call.phone_number and q.phone_number == call.phone_number:
            return q
    for q in quotes:
        if q.quote_id != call.quote_id and q.company_name == call.company_name:
            return q
    return None


def _line_items_from_params(params: Dict[str, Any]) -> List[LineItem]:
    items: List[LineItem] = []
    for li in (params.get("line_items") or []):
        try:
            items.append(LineItem(**li) if isinstance(li, dict) else li)
        except Exception:
            continue  # skip a malformed line item rather than failing the whole quote
    return items


def _total_from_params(params: Dict[str, Any], line_items: List[LineItem]) -> Optional[float]:
    total = params.get("total_price")
    if total is not None:
        return total
    summed = sum(li.amount for li in line_items)
    return summed if summed else params.get("base_price")


def _outcome_from_params(params: Dict[str, Any]) -> CallOutcome:
    try:
        return CallOutcome(params.get("outcome") or "quote_given")
    except ValueError:
        return CallOutcome.QUOTE_GIVEN


async def _apply_first_pass_quote(job_id: str, call: CallRecord, params: Dict[str, Any]) -> Quote:
    """First-pass call → one new Quote, linked to its call."""
    line_items = _line_items_from_params(params)
    quote = Quote(
        job_id=job_id,
        call_id=call.call_id,
        company_name=call.company_name or params.get("company_name") or "Unknown",
        phone_number=call.phone_number,
        base_price=params.get("base_price"),
        line_items=line_items,
        total_price=_total_from_params(params, line_items),
        negotiation_style_label=call.negotiation_style_label,
        outcome=_outcome_from_params(params),
        binding=bool(params.get("binding", False)),
        callback_time=_parse_dt(params.get("callback_time")),
        negotiation_notes=params.get("notes"),
    )
    async with _STATE_LOCK:
        QUOTES[job_id].append(quote)
        call.quote_id = quote.quote_id
    return quote


async def _apply_negotiation_result(job_id: str, call: CallRecord, params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Negotiation callback → update the company's existing quote *in place* so
    there's still exactly one quote per company, now carrying both the
    pre- and post-negotiation totals. The quote's transcript link is moved to
    this callback call, where the price actually moved. Falls back to a fresh
    first-pass quote if no earlier quote is found.
    """
    original = _find_original_quote(job_id, call)
    if original is None:
        quote = await _apply_first_pass_quote(job_id, call, params)
        return {"quote_id": quote.quote_id, "price_moved": False}

    line_items = _line_items_from_params(params)
    new_total = _total_from_params(params, line_items)

    async with _STATE_LOCK:
        if original.pre_negotiation_total is None:
            original.pre_negotiation_total = original.total_price
        prior = original.pre_negotiation_total
        if new_total is not None:
            original.post_negotiation_total = new_total
        # Keep the original full itemization — the callback's log_quote often
        # lists only what *changed* (e.g. "base discounted, fuel waived"), so
        # overwriting would drop real line items (stairs, piano) and trip a
        # false "missing fee" red flag. The price move lives in pre/post totals
        # and the notes below.
        if params.get("notes"):
            original.negotiation_notes = params["notes"]
        if params.get("binding"):
            original.binding = True
        original.updated_at = datetime.utcnow()
        call.quote_id = original.quote_id  # link the callback call to the quote it moved

    price_moved = bool(prior and new_total and new_total != prior)
    return {"quote_id": original.quote_id, "price_moved": price_moved,
            "from": prior, "to": new_total}


@app.post("/calls/{job_id}/{call_id}/webhook")
async def call_quote_webhook(job_id: str, call_id: str, body: QuoteWebhookBody) -> Dict[str, Any]:
    """Target for the Caller agent's `log_quote` tool on real telephony calls.
    Idempotent: a retried tool call with the same content won't duplicate a
    quote. Handles both first-pass calls and negotiation callbacks (branching
    on the call record's is_negotiation_callback flag)."""
    _job_or_404(job_id)
    call = _call_or_404(job_id, call_id)

    key = _idempotency_key(body.model_dump(exclude={"event_id"}, mode="json"), body.event_id)
    if key in call.applied_webhook_events:
        return {"status": "already_applied", "call_id": call_id}

    params = body.model_dump(mode="json")
    async with _STATE_LOCK:
        call.applied_webhook_events.append(key)

    if call.is_negotiation_callback:
        result = await _apply_negotiation_result(job_id, call, params)
    else:
        quote = await _apply_first_pass_quote(job_id, call, params)
        result = {"quote_id": quote.quote_id, "price_moved": False}

    return {"status": "ok", **result}


@app.get("/calls/recording/{conversation_id}")
async def proxy_recording(conversation_id: str):
    """Backend proxy for call audio so the ElevenLabs API key never reaches
    the browser. Streams binary audio through."""
    from fastapi.responses import StreamingResponse
    import httpx as _httpx

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail={"error": "elevenlabs_not_configured"})

    url = f"{elevenlabs_client.ELEVENLABS_BASE_URL}/v1/convai/conversations/{conversation_id}/audio"
    client = _httpx.AsyncClient(timeout=30.0)
    try:
        resp = await client.get(url, headers={"xi-api-key": api_key})
    except _httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail={"error": "recording_fetch_failed", "message": str(exc)}) from exc
    if resp.status_code >= 400:
        await client.aclose()
        raise HTTPException(status_code=resp.status_code, detail={"error": "recording_fetch_failed"})

    async def _stream():
        yield resp.content
        await client.aclose()

    return StreamingResponse(_stream(), media_type="audio/mpeg")


@app.get("/calls/{job_id}/{call_id}/audio")
async def call_audio_replay(job_id: str, call_id: str):
    """AI-voiced replay of a simulated call: the actual transcript, synthesized
    with two distinct ElevenLabs voices (agent vs counterparty) and cached per
    call. Synthesis happens on first play (the <audio> tags use preload=none)
    so TTS credits are only spent on calls someone actually listens to."""
    _job_or_404(job_id)
    call = _call_or_404(job_id, call_id)
    if not call.transcript:
        raise HTTPException(status_code=404, detail={"error": "no_transcript", "message": "This call has no transcript to voice."})
    try:
        config.require_elevenlabs_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error": "elevenlabs_not_configured", "message": str(exc)}) from exc

    audio = AUDIO_CACHE.get(call_id)
    if audio is None:
        style = call.negotiation_style_label.value if call.negotiation_style_label else None
        turns = [t.model_dump() for t in call.transcript]
        try:
            audio = await asyncio.to_thread(
                elevenlabs_client.synthesize_transcript_audio, turns, counterparty_style=style
            )
        except elevenlabs_client.ElevenLabsClientError as exc:
            raise HTTPException(status_code=502, detail={"error": "tts_failed", "message": str(exc)}) from exc
        AUDIO_CACHE[call_id] = audio

    from fastapi.responses import Response
    return Response(content=audio, media_type="audio/mpeg",
                    headers={"Cache-Control": "private, max-age=3600"})


@app.get("/quotes/{job_id}")
def list_quotes(job_id: str) -> List[Quote]:
    _job_or_404(job_id)
    return QUOTES.get(job_id, [])


# ──────────────────────────────────────────────────────────────────────────
# Caller — simulation path (agent-to-agent, no telephony)
# ──────────────────────────────────────────────────────────────────────────

class SimulateCallsRequest(BaseModel):
    styles: List[NegotiationStyle] = Field(
        default_factory=list,
        description="Counterparty styles to run. Defaults to every configured style (the 3 demo "
                    "personas), satisfying the challenge's 'at least three distinct styles'.",
    )
    new_turns_limit: int = 30


# Fire-and-forget background tasks: each simulation takes 30-60s, far longer
# than a proxied HTTP request should stay open. We register in-progress call
# records, kick the simulations into the background, and return immediately;
# the frontend's existing /calls + /quotes polling surfaces completion.
_BG_TASKS: set = set()


def _spawn_bg(coro) -> None:
    """Fire-and-forget a coroutine, holding a reference so it isn't GC'd."""
    task = asyncio.create_task(coro)
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)


async def _synthesize_audio_bg(call: CallRecord) -> None:
    """Pre-voice a completed call's transcript in the background so the audio
    player is instant when someone presses play. Failure is non-fatal — the
    /audio endpoint will retry on demand."""
    try:
        if call.call_id in AUDIO_CACHE or not call.transcript:
            return
        style = call.negotiation_style_label.value if call.negotiation_style_label else None
        turns = [t.model_dump() for t in call.transcript]
        AUDIO_CACHE[call.call_id] = await asyncio.to_thread(
            elevenlabs_client.synthesize_transcript_audio, turns, counterparty_style=style
        )
        logger.info("pre-synthesized audio for call %s (%d bytes)", call.call_id, len(AUDIO_CACHE[call.call_id]))
    except Exception as exc:
        logger.warning("audio pre-synthesis failed for %s: %s", call.call_id, exc)


async def _run_one_simulation(*, job_id: str, record: CallRecord, persona: Dict[str, Any],
                              caller_agent_id: str, call_context: Dict[str, Any],
                              new_turns_limit: int) -> None:
    try:
        resp = await asyncio.to_thread(
            elevenlabs_client.simulate_conversation,
            caller_agent_id=caller_agent_id,
            counterparty_prompt=persona["prompt_text"],
            counterparty_first_message=persona["first_message"],
            dynamic_variables={**call_context, "call_id": record.call_id},
            new_turns_limit=new_turns_limit,
        )
        turns, logged = elevenlabs_client.parse_simulation_result(resp)
        record.transcript = [TranscriptTurn(**t) for t in turns]
        record.status = CallStatus.COMPLETED
        record.ended_at = datetime.utcnow()
        if turns:
            record.recording_url = f"/api/calls/{job_id}/{record.call_id}/audio"
            _spawn_bg(_synthesize_audio_bg(record))  # voice it now so play is instant
        if logged:
            await _apply_first_pass_quote(job_id, record, logged)
    except elevenlabs_client.ElevenLabsClientError as exc:
        record.status = CallStatus.FAILED
        record.error = str(exc)
    except Exception as exc:  # a background task must never fail silently
        record.status = CallStatus.FAILED
        record.error = f"unexpected error: {exc}"


async def _run_one_negotiation(*, job_id: str, record: CallRecord, caller_agent_id: str,
                               counterparty_prompt: str, counterparty_first_message: str,
                               dynamic_variables: Dict[str, Any]) -> None:
    try:
        resp = await asyncio.to_thread(
            elevenlabs_client.simulate_conversation,
            caller_agent_id=caller_agent_id,
            counterparty_prompt=counterparty_prompt,
            counterparty_first_message=counterparty_first_message,
            dynamic_variables=dynamic_variables,
            new_turns_limit=30,
        )
        turns, logged = elevenlabs_client.parse_simulation_result(resp)
        record.transcript = [TranscriptTurn(**t) for t in turns]
        record.status = CallStatus.COMPLETED
        record.ended_at = datetime.utcnow()
        if turns:
            record.recording_url = f"/api/calls/{job_id}/{record.call_id}/audio"
            _spawn_bg(_synthesize_audio_bg(record))
        if logged:
            await _apply_negotiation_result(job_id, record, logged)
    except elevenlabs_client.ElevenLabsClientError as exc:
        record.status = CallStatus.FAILED
        record.error = str(exc)
    except Exception as exc:
        record.status = CallStatus.FAILED
        record.error = f"unexpected error: {exc}"


@app.post("/calls/{job_id}/simulate")
async def simulate_calls(job_id: str, body: SimulateCallsRequest) -> List[CallRecord]:
    """
    Run the real Caller agent against each counterparty persona via ElevenLabs'
    agent simulation — a genuine, unscripted agent-to-agent negotiation. The
    Caller's log_quote tool call is read straight from the returned transcript,
    so no webhook/telephony is involved. This is the always-available demo path.
    """
    job = _job_or_404(job_id)
    if not job.confirmed:
        raise HTTPException(
            status_code=409,
            detail={"error": "job_not_confirmed", "message": "Confirm the job spec before placing calls."},
        )
    try:
        config.require_simulation_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error": "simulation_not_configured", "message": str(exc)}) from exc

    vconfig = config.load_vertical_config(job.vertical)
    styles = [s.value for s in body.styles] or list(vconfig.get("counterparty_styles", {}).keys())
    if len(styles) < 3:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "insufficient_styles",
                "message": "The challenge requires at least three distinct negotiation styles.",
                "available": list(vconfig.get("counterparty_styles", {}).keys()),
            },
        )

    caller_agent_id = os.environ["ELEVENLABS_CALLER_AGENT_ID"]
    call_context = job.as_call_context()

    records: List[CallRecord] = []
    to_run: List[tuple] = []
    for style in styles:
        try:
            persona = config.load_counterparty_persona(job.vertical, style)
        except config.VerticalConfigError as exc:
            records.append(CallRecord(
                job_id=job_id, company_name=style, phone_number=f"sim:{style}",
                status=CallStatus.FAILED, mode="simulation", error=str(exc),
            ))
            continue
        record = CallRecord(
            job_id=job_id,
            company_name=persona["company_name"],
            phone_number=f"sim:{style}",
            negotiation_style_label=NegotiationStyle(style),
            status=CallStatus.IN_PROGRESS,
            mode="simulation",
            started_at=datetime.utcnow(),
        )
        records.append(record)
        to_run.append((record, persona))

    async with _STATE_LOCK:
        CALLS[job_id].extend(records)
    for record, persona in to_run:
        _spawn_bg(_run_one_simulation(
            job_id=job_id, record=record, persona=persona,
            caller_agent_id=caller_agent_id, call_context=call_context,
            new_turns_limit=body.new_turns_limit,
        ))
    return records


# ──────────────────────────────────────────────────────────────────────────
# Closer — negotiation
# ──────────────────────────────────────────────────────────────────────────

class NegotiateStartRequest(BaseModel):
    callback_call_ids: List[str] = Field(
        default_factory=list,
        description="Which existing calls to call back with leverage. If empty, defaults to "
                    "every quoted call except the current cheapest.",
    )


@app.post("/negotiate/{job_id}/start")
async def start_negotiation(job_id: str, body: NegotiateStartRequest) -> List[CallRecord]:
    job = _job_or_404(job_id)
    quotes = [q for q in QUOTES.get(job_id, []) if q.outcome == CallOutcome.QUOTE_GIVEN and q.total_price]
    if len(quotes) < 2:
        raise HTTPException(
            status_code=409,
            detail={"error": "insufficient_quotes", "message": "Need at least 2 usable quotes before negotiating leverage."},
        )
    try:
        config.require_calling_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error": "calling_not_configured", "message": str(exc)}) from exc

    cheapest = min(quotes, key=lambda q: q.total_price)
    targets_call_ids = body.callback_call_ids or [q.call_id for q in quotes if q.quote_id != cheapest.quote_id]

    calls_by_id = {c.call_id: c for c in CALLS.get(job_id, [])}
    quotes_by_call_id = {q.call_id: q for q in quotes}

    agent_id = os.environ["ELEVENLABS_CALLER_AGENT_ID"]
    phone_number_id = os.environ["ELEVENLABS_CALLER_PHONE_NUMBER_ID"]
    base_context = job.as_call_context()

    new_records: List[CallRecord] = []
    for call_id in targets_call_ids:
        original_call = calls_by_id.get(call_id)
        if not original_call:
            continue
        target_quote = quotes_by_call_id.get(call_id)

        callback_record = CallRecord(
            job_id=job_id,
            company_name=original_call.company_name,
            phone_number=original_call.phone_number,
            negotiation_style_label=original_call.negotiation_style_label,
            status=CallStatus.DIALING,
            is_negotiation_callback=True,
            competing_quote_used_as_leverage=cheapest.quote_id,
            negotiating_quote_id=(target_quote.quote_id if target_quote else None),
            mode="telephony",
        )

        dynamic_vars = {
            **base_context,
            "call_id": callback_record.call_id,
            "is_negotiation_callback": True,
            "leverage_quote_company": cheapest.company_name,
            "leverage_quote_total": cheapest.total_price,
            "this_company_previous_total": target_quote.total_price if target_quote else "not specified",
        }

        try:
            result = await asyncio.to_thread(
                elevenlabs_client.place_outbound_call,
                agent_id=agent_id,
                agent_phone_number_id=phone_number_id,
                to_number=original_call.phone_number,
                dynamic_variables=dynamic_vars,
            )
            callback_record.elevenlabs_conversation_id = result["conversation_id"]
            callback_record.twilio_call_sid = result.get("call_sid")
            callback_record.status = CallStatus.IN_PROGRESS
            callback_record.started_at = datetime.utcnow()
        except elevenlabs_client.ElevenLabsClientError as exc:
            callback_record.status = CallStatus.FAILED
            callback_record.error = str(exc)

        if target_quote:
            target_quote.pre_negotiation_total = target_quote.total_price

        new_records.append(callback_record)

    async with _STATE_LOCK:
        CALLS[job_id].extend(new_records)
    return new_records


@app.post("/negotiate/{job_id}/simulate")
async def simulate_negotiation(job_id: str, body: NegotiateStartRequest) -> List[CallRecord]:
    """
    Negotiation via agent simulation. For each target company, the Caller
    calls back in negotiation mode — armed with the real cheapest competing
    quote as leverage — against the same counterparty persona, now primed to
    remember what it quoted the first time. Whether the price moves is decided
    by the persona on the merits, not a script. The revised total updates that
    company's quote in place (pre → post).
    """
    job = _job_or_404(job_id)
    quotes = [q for q in QUOTES.get(job_id, []) if q.outcome == CallOutcome.QUOTE_GIVEN and q.total_price]
    if len(quotes) < 2:
        raise HTTPException(
            status_code=409,
            detail={"error": "insufficient_quotes", "message": "Need at least 2 usable quotes before negotiating leverage."},
        )
    try:
        config.require_simulation_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error": "simulation_not_configured", "message": str(exc)}) from exc

    cheapest = min(quotes, key=lambda q: q.total_price)
    target_call_ids = body.callback_call_ids or [q.call_id for q in quotes if q.quote_id != cheapest.quote_id]
    calls_by_id = {c.call_id: c for c in CALLS.get(job_id, [])}
    quotes_by_call_id = {q.call_id: q for q in quotes}

    caller_agent_id = os.environ["ELEVENLABS_CALLER_AGENT_ID"]
    base_context = job.as_call_context()

    records: List[CallRecord] = []
    to_run: List[tuple] = []
    for call_id in target_call_ids:
        original_call = calls_by_id.get(call_id)
        target_quote = quotes_by_call_id.get(call_id)
        if not original_call or not target_quote:
            continue
        style = original_call.negotiation_style_label.value if original_call.negotiation_style_label else None
        if not style:
            continue
        try:
            persona = config.load_counterparty_persona(job.vertical, style)
        except config.VerticalConfigError:
            continue

        prev_total = target_quote.total_price
        # Prime the persona with what it already quoted, so the callback is a real
        # continuation rather than a fresh cold call. It still decides on the merits.
        primed_prompt = (
            persona["prompt_text"]
            + "\n\n## This is a CALLBACK — you have spoken to this customer before\n"
            + f"Earlier in the day you quoted this same customer a total of about ${prev_total:,.0f} "
            + "for this exact job. They are calling back because they've now gathered a competing "
            + "quote. Stay fully in character: concede toward the competing number only if and as far "
            + "as your persona genuinely would, and only for a real reason. If you move, state the new "
            + "number and what changed; if you hold, say so plainly."
        )

        callback_record = CallRecord(
            job_id=job_id,
            company_name=original_call.company_name,
            phone_number=original_call.phone_number,
            negotiation_style_label=original_call.negotiation_style_label,
            status=CallStatus.IN_PROGRESS,
            mode="simulation",
            is_negotiation_callback=True,
            competing_quote_used_as_leverage=cheapest.quote_id,
            negotiating_quote_id=target_quote.quote_id,
            started_at=datetime.utcnow(),
        )

        dynamic_vars = {
            **base_context,
            "call_id": callback_record.call_id,
            "is_negotiation_callback": True,
            "leverage_quote_company": cheapest.company_name,
            "leverage_quote_total": cheapest.total_price,
            "this_company_previous_total": prev_total,
        }

        records.append(callback_record)
        to_run.append((callback_record, primed_prompt, persona["first_message"], dynamic_vars))

    async with _STATE_LOCK:
        CALLS[job_id].extend(records)
    for record, prompt, first_message, dvars in to_run:
        _spawn_bg(_run_one_negotiation(
            job_id=job_id, record=record, caller_agent_id=caller_agent_id,
            counterparty_prompt=prompt, counterparty_first_message=first_message,
            dynamic_variables=dvars,
        ))
    return records


@app.post("/negotiate/{job_id}/{call_id}/webhook")
async def negotiation_webhook(job_id: str, call_id: str, body: QuoteWebhookBody) -> Dict[str, Any]:
    """Back-compat alias. The Caller agent uses one `log_quote` tool pointing at
    /calls/{job_id}/{call_id}/webhook for both first-pass and callback calls;
    that handler already branches on the call's is_negotiation_callback flag.
    This route delegates to it so an agent wired to the older path still works."""
    return await call_quote_webhook(job_id, call_id, body)


# ──────────────────────────────────────────────────────────────────────────
# Closer — report
# ──────────────────────────────────────────────────────────────────────────

def _apply_red_flags(job: JobSpec, quotes: List[Quote], vconfig: Dict[str, Any]) -> List[str]:
    benchmark = vconfig["price_benchmark"]
    bedrooms = job.fields.get("bedrooms") or 2
    scaled_median = benchmark["median_usd"] + benchmark["per_bedroom_adjustment_usd"] * (bedrooms - 2)
    threshold_pct = next(
        (r["threshold_pct_below_median"] for r in vconfig["red_flag_rules"] if r["id"] == "below_market_30pct"),
        30,
    )
    floor = scaled_median * (1 - threshold_pct / 100)

    flags: List[str] = []
    stairs_total = (job.fields.get("stairs_origin") or 0) + (job.fields.get("stairs_destination") or 0)
    long_carry = bool(job.fields.get("long_carry_expected"))

    for q in quotes:
        reasons = []
        if q.total_price is not None and q.total_price < floor:
            pct_below = round((1 - q.total_price / scaled_median) * 100)
            q.red_flag_pct_below_market = pct_below
            reasons.append(
                f"${q.total_price:,.0f} is {pct_below}% below the market median "
                f"(~${scaled_median:,.0f} for this job) — classic lowball-then-upcharge pattern."
            )
        if q.outcome == CallOutcome.QUOTE_GIVEN and not q.binding:
            reasons.append("Company would not confirm this number is binding/firm.")
        if (stairs_total > 0 or long_carry) and q.line_items:
            labels = " ".join(li.label.lower() for li in q.line_items)
            if "stair" not in labels and "carry" not in labels:
                reasons.append("No stairs/long-carry fee itemized despite the job spec noting stairs or a long carry — likely to surprise on moving day.")

        # cash_only_or_large_deposit: scan the itemization + notes for a
        # cash-only demand or a deposit over 25% of the total — a common
        # hostage-load precursor per BBB guidance. The hard-sell persona pushes
        # exactly this ("40% deposit, cash or Zelle"), landing in notes/line items.
        blob = " ".join(
            filter(None, [q.negotiation_notes or ""]
            + [li.label for li in q.line_items]
            + [li.notes or "" for li in q.line_items])
        ).lower()
        if any(term in blob for term in ("cash only", "cash-only", "cash or zelle", "zelle only", "wire only", "no cards")):
            reasons.append("Pushes cash-only / non-reversible payment — a hostage-load precursor per BBB guidance.")
        for li in q.line_items:
            if "deposit" in li.label.lower() and q.total_price and li.amount > 0.25 * q.total_price:
                reasons.append(
                    f"Requires a ${li.amount:,.0f} deposit — over 25% of the ${q.total_price:,.0f} total, "
                    f"a hostage-load risk per BBB guidance."
                )
                break
        else:
            import re as _re
            m = _re.search(r"(\d{2,3})\s*%\s*deposit", blob)
            if m and int(m.group(1)) > 25:
                reasons.append(f"Demands a {m.group(1)}% deposit up front — over 25%, a hostage-load risk per BBB guidance.")

        if reasons:
            q.is_red_flag = True
            q.red_flag_reason = " ".join(reasons)
            flags.append(f"{q.company_name}: {q.red_flag_reason}")

    return flags


def _rank_quotes(quotes: List[Quote], calls: List[CallRecord]) -> List[RankedQuote]:
    calls_by_id = {c.call_id: c for c in calls}
    usable = [q for q in quotes if q.outcome == CallOutcome.QUOTE_GIVEN and q.total_price]

    def sort_key(q: Quote):
        effective_price = q.post_negotiation_total or q.total_price
        # Non-flagged quotes rank cheapest-first (best trustworthy deal). Flagged
        # quotes always rank below them, and among themselves the *most expensive*
        # ranks first — a suspiciously cheap flagged quote is the least
        # trustworthy, not the best buy.
        return (q.is_red_flag, effective_price if not q.is_red_flag else -effective_price)

    ranked_sorted = sorted(usable, key=sort_key)
    result = []
    for i, q in enumerate(ranked_sorted, start=1):
        call = calls_by_id.get(q.call_id)
        notes = []
        effective_price = q.post_negotiation_total or q.total_price
        notes.append(f"Effective total: ${effective_price:,.0f}" + (" (post-negotiation)" if q.post_negotiation_total else ""))
        if q.is_red_flag:
            notes.append(f"RED FLAG: {q.red_flag_reason}")
        if not q.binding:
            notes.append("Not confirmed as binding.")
        result.append(RankedQuote(rank=i, quote=q, call=call, score_notes=" ".join(notes)))
    return result


@app.get("/report/{job_id}")
async def get_report(job_id: str) -> Report:
    job = _job_or_404(job_id)
    quotes = QUOTES.get(job_id, [])
    calls = CALLS.get(job_id, [])
    if not quotes:
        raise HTTPException(status_code=409, detail={"error": "no_quotes_yet", "message": "No quotes logged for this job yet."})

    try:
        config.require_openai_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error": "openai_not_configured", "message": str(exc)}) from exc

    vconfig = config.load_vertical_config(job.vertical)
    red_flags = _apply_red_flags(job, quotes, vconfig)
    ranked = _rank_quotes(quotes, calls)

    prices = [
        (q.quote.post_negotiation_total or q.quote.total_price)
        for q in ranked if (q.quote.post_negotiation_total or q.quote.total_price)
    ]
    market_spread = {
        "min": min(prices) if prices else 0.0,
        "max": max(prices) if prices else 0.0,
        "median": sorted(prices)[len(prices) // 2] if prices else 0.0,
    }

    recommended_quote_id = None
    non_flagged = [r for r in ranked if not r.quote.is_red_flag]
    if non_flagged:
        recommended_quote_id = non_flagged[0].quote.quote_id
    elif ranked:
        recommended_quote_id = ranked[0].quote.quote_id

    try:
        summary = await openai_client.generate_recommendation(
            job_fields=job.fields,
            quotes=[
                {
                    "company": r.quote.company_name,
                    "total": r.quote.post_negotiation_total or r.quote.total_price,
                    "binding": r.quote.binding,
                    "is_red_flag": r.quote.is_red_flag,
                    "red_flag_reason": r.quote.red_flag_reason,
                    "negotiation_notes": r.quote.negotiation_notes,
                }
                for r in ranked
            ],
            red_flags=red_flags,
        )
    except openai_client.OpenAIClientError as exc:
        raise HTTPException(status_code=502, detail={"error": "recommendation_failed", "message": str(exc)}) from exc

    REPORT_SUMMARY_CACHE[job_id] = summary  # so /report/{job_id}/audio can voice it
    AUDIO_CACHE.pop(f"report:{job_id}", None)  # summary changed → stale spoken version

    return Report(
        job_id=job_id,
        ranked_quotes=ranked,
        recommended_quote_id=recommended_quote_id,
        plain_language_summary=summary,
        market_spread=market_spread,
        red_flags=red_flags,
    )


@app.get("/report/{job_id}/audio")
async def report_audio(job_id: str):
    """The recommendation, spoken aloud in the agent's voice — synthesized from
    the most recently generated report summary and cached until it changes."""
    _job_or_404(job_id)
    summary = REPORT_SUMMARY_CACHE.get(job_id)
    if not summary:
        raise HTTPException(status_code=404, detail={"error": "no_report_yet", "message": "Generate the report first."})
    try:
        config.require_elevenlabs_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error": "elevenlabs_not_configured", "message": str(exc)}) from exc

    cache_key = f"report:{job_id}"
    audio = AUDIO_CACHE.get(cache_key)
    if audio is None:
        turns = [{"speaker": "agent", "text": summary}]
        try:
            audio = await asyncio.to_thread(elevenlabs_client.synthesize_transcript_audio, turns, max_chars_per_turn=2000)
        except elevenlabs_client.ElevenLabsClientError as exc:
            raise HTTPException(status_code=502, detail={"error": "tts_failed", "message": str(exc)}) from exc
        AUDIO_CACHE[cache_key] = audio

    from fastapi.responses import Response
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})


api = app  # Vercel's Python builder discovers `app` (or `api`) at module scope
