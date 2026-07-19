"""
ElevenLabs Agents integration for CallPilot (SDK 2.x).

Two call paths, one agent config:

  simulation — conversational_ai.agents.simulate_conversation runs the real
               Caller agent (its actual system prompt + tools) against a
               counterparty *persona* supplied as the simulated user. This is
               a genuine, unscripted agent-to-agent negotiation: the Caller
               reasons, the counterparty pushes back, the price moves (or
               doesn't) on the merits. The Caller's `log_quote` tool call is
               captured directly from the returned transcript
               (tool_calls[].params_as_json) — no webhook, no telephony, no
               Twilio. The tool is mocked so the simulation never stalls
               waiting on an HTTP endpoint.

  telephony  — conversational_ai.twilio.outbound_call places a real voice
               call; status/transcript/audio are polled from
               conversational_ai.conversations. The `log_quote` tool is a
               real webhook hitting WEBHOOK_BASE_URL.

Nothing here fabricates provider output: every failure raises
ElevenLabsClientError rather than returning a synthesized conversation id,
transcript, or quote.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple

import httpx
from elevenlabs import ElevenLabs

ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"

# ElevenLabs runs the agent LLM on its own platform (not billed to your OpenAI
# key). Override with ELEVENLABS_AGENT_LLM if this model isn't on your plan.
DEFAULT_AGENT_LLM = os.environ.get("ELEVENLABS_AGENT_LLM", "gpt-4.1")

LOG_QUOTE_TOOL_NAME = "log_quote"


class ElevenLabsClientError(RuntimeError):
    pass


def _api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise ElevenLabsClientError("ELEVENLABS_API_KEY is not configured.")
    return key


def _sdk_client() -> ElevenLabs:
    return ElevenLabs(api_key=_api_key())


def _attr(obj: Any, key: str, default: Any = None) -> Any:
    """Read `key` whether obj is a pydantic model or a plain dict."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


# ──────────────────────────────────────────────────────────────────────────
# Simulation path (agent-to-agent, no telephony)
# ──────────────────────────────────────────────────────────────────────────

def simulate_conversation(
    *,
    caller_agent_id: str,
    counterparty_prompt: str,
    counterparty_first_message: str,
    dynamic_variables: Dict[str, Any],
    counterparty_llm: Optional[str] = None,
    new_turns_limit: int = 30,
) -> Any:
    """
    Run the Caller agent against a counterparty persona. Returns the raw
    AgentSimulatedChatTestResponseModel (parse with parse_simulation_result).

    The counterparty is the *simulated user*: its persona prompt is one of
    prompts/counterparty_*.md, and its first_message is how it answers the
    phone. dynamic_variables carries the confirmed JobSpec so the Caller's
    {{origin_address}} etc. resolve identically to a real call.
    """
    client = _sdk_client()

    simulation_specification: Dict[str, Any] = {
        "simulated_user_config": {
            "prompt": {
                "prompt": counterparty_prompt,
                "llm": counterparty_llm or DEFAULT_AGENT_LLM,
            },
            "first_message": counterparty_first_message,
        },
        # Mock log_quote so the Caller's tool call resolves instantly instead of
        # trying to reach a webhook that isn't part of the simulation.
        "tool_mock_config": {
            LOG_QUOTE_TOOL_NAME: {"default_return_value": '{"status": "ok"}', "default_is_error": False},
        },
        "dynamic_variables": dynamic_variables,
    }

    try:
        return client.conversational_ai.agents.simulate_conversation(
            agent_id=caller_agent_id,
            simulation_specification=simulation_specification,
            new_turns_limit=new_turns_limit,
        )
    except Exception as exc:  # provider SDK raises its own exception types
        raise ElevenLabsClientError(f"Agent simulation failed: {exc}") from exc


def parse_simulation_result(response: Any) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Normalize a simulation response into (transcript_turns, logged_quote).

    transcript_turns: [{"speaker": "agent"|"counterparty", "text", "timestamp_s"}]
    logged_quote:     the parsed params of the Caller's *last* log_quote tool
                      call (dict), or None if it never logged one. "Last" so a
                      negotiation callback's revised quote wins over an earlier
                      one in the same run.
    """
    convo = _attr(response, "simulated_conversation", []) or []

    turns: List[Dict[str, Any]] = []
    logged_quote: Optional[Dict[str, Any]] = None

    for i, turn in enumerate(convo):
        role = _attr(turn, "role", "agent")
        speaker = "agent" if role == "agent" else "counterparty"
        message = _attr(turn, "message") or ""
        if message:
            turns.append({
                "speaker": speaker,
                "text": message,
                "timestamp_s": float(_attr(turn, "time_in_call_secs", i) or i),
            })

        for tc in (_attr(turn, "tool_calls", []) or []):
            if _attr(tc, "tool_name") != LOG_QUOTE_TOOL_NAME:
                continue
            raw_params = _attr(tc, "params_as_json") or "{}"
            try:
                parsed = json.loads(raw_params) if isinstance(raw_params, str) else dict(raw_params)
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
            logged_quote = parsed  # keep the latest

    return turns, logged_quote


# ──────────────────────────────────────────────────────────────────────────
# Telephony path (real outbound voice)
# ──────────────────────────────────────────────────────────────────────────

def place_outbound_call(
    *,
    agent_id: str,
    agent_phone_number_id: str,
    to_number: str,
    dynamic_variables: Dict[str, Any],
    record_call: bool = True,
) -> Dict[str, Any]:
    """
    Places one real outbound call. dynamic_variables = the confirmed
    JobSpec.as_call_context() (plus call_id / negotiation leverage). Returns
    {"conversation_id", "call_sid"}; raises on any provider failure — never
    fabricates a conversation_id.
    """
    client = _sdk_client()

    try:
        response = client.conversational_ai.twilio.outbound_call(
            agent_id=agent_id,
            agent_phone_number_id=agent_phone_number_id,
            to_number=to_number,
            call_recording_enabled=record_call,
            conversation_initiation_client_data={"dynamic_variables": dynamic_variables},
        )
    except Exception as exc:
        raise ElevenLabsClientError(f"Failed to place outbound call to {to_number}: {exc}") from exc

    conversation_id = _attr(response, "conversation_id")
    call_sid = _attr(response, "call_sid") or _attr(response, "callSid")

    if not conversation_id:
        raise ElevenLabsClientError(
            f"ElevenLabs did not return a conversation_id for call to {to_number}: {response}"
        )
    return {"conversation_id": conversation_id, "call_sid": call_sid}


async def get_conversation(conversation_id: str) -> Dict[str, Any]:
    """Poll conversation status/transcript/recording. Raises on failure rather
    than returning stale/fake data. Raw REST — the contract is stable and
    avoids SDK response-model churn."""
    url = f"{ELEVENLABS_BASE_URL}/v1/convai/conversations/{conversation_id}"
    headers = {"xi-api-key": _api_key()}

    async with httpx.AsyncClient(timeout=15.0) as http:
        try:
            resp = await http.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise ElevenLabsClientError(f"Failed to reach ElevenLabs for conversation {conversation_id}: {exc}") from exc

    if resp.status_code == 404:
        raise ElevenLabsClientError(f"Conversation {conversation_id} not found (may still be initializing).")
    if resp.status_code >= 400:
        raise ElevenLabsClientError(f"ElevenLabs returned {resp.status_code} for conversation {conversation_id}: {resp.text}")

    return resp.json()


def extract_transcript_turns(conversation_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Normalize a polled conversation payload's transcript into TranscriptTurn
    shape. Defensive about payload shape drift."""
    turns = []
    for i, turn in enumerate(conversation_payload.get("transcript", []) or []):
        role = turn.get("role") or turn.get("speaker") or "unknown"
        speaker = "agent" if role in ("agent", "assistant") else "counterparty"
        text = turn.get("message") or turn.get("text") or ""
        turns.append({"speaker": speaker, "text": text, "timestamp_s": turn.get("time_in_call_secs", float(i))})
    return turns


def extract_logged_quote_from_conversation(conversation_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Pull the Caller's last log_quote tool-call params from a polled
    telephony conversation, so a quote is captured even if the live webhook
    was unreachable. Returns None if no log_quote call is present."""
    logged: Optional[Dict[str, Any]] = None
    for turn in conversation_payload.get("transcript", []) or []:
        for tc in (turn.get("tool_calls") or []):
            if (tc.get("tool_name") or tc.get("name")) != LOG_QUOTE_TOOL_NAME:
                continue
            raw = tc.get("params_as_json") or tc.get("parameters") or "{}"
            try:
                logged = json.loads(raw) if isinstance(raw, str) else dict(raw)
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
    return logged


# ── Simulated-call audio (TTS replay) ──────────────────────────────────────
# Premade ElevenLabs voices: the Caller agent gets one consistent voice; each
# counterparty persona gets its own so the call sounds like two people.
AGENT_VOICE_ID = os.environ.get("ELEVENLABS_AGENT_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # Rachel
COUNTERPARTY_VOICE_IDS = {
    "tough_negotiator": "onwK4e9ZLuTAKqWW03F9",   # Daniel — brusque, professional
    "stonewaller": "TxGEqnHWrfWFTfGW9XjX",        # Josh — distracted, casual
    "hard_sell_upseller": "pNInz6obpgDQGcFmaJgB", # Adam — fast-talking sales
}
DEFAULT_COUNTERPARTY_VOICE = "pNInz6obpgDQGcFmaJgB"
TTS_MODEL = os.environ.get("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5")


def synthesize_transcript_audio(
    turns: List[Dict[str, Any]],
    *,
    counterparty_style: Optional[str] = None,
    max_turns: int = 40,
    max_chars_per_turn: int = 500,
) -> bytes:
    """
    Voice a call transcript with ElevenLabs TTS — the agent and the
    counterparty each get a distinct voice, and the MP3 segments are
    concatenated into one playable stream. This is an AI-voiced replay of the
    *actual* simulated conversation (the UI labels it as such), giving the
    simulation path playable audio without telephony.
    """
    client = _sdk_client()
    cp_voice = COUNTERPARTY_VOICE_IDS.get(counterparty_style or "", DEFAULT_COUNTERPARTY_VOICE)

    out = bytearray()
    for turn in turns[:max_turns]:
        text = (turn.get("text") or "").strip()[:max_chars_per_turn]
        if not text:
            continue
        voice_id = AGENT_VOICE_ID if turn.get("speaker") == "agent" else cp_voice
        try:
            audio_iter = client.text_to_speech.convert(
                voice_id,
                text=text,
                model_id=TTS_MODEL,
                output_format="mp3_44100_128",
            )
            for chunk in audio_iter:
                out.extend(chunk)
        except Exception as exc:
            raise ElevenLabsClientError(f"TTS synthesis failed mid-transcript: {exc}") from exc

    if not out:
        raise ElevenLabsClientError("Transcript had no speakable turns to synthesize.")
    return bytes(out)


def get_recording_url(conversation_id: str) -> str:
    """Audio is binary at GET /v1/convai/conversations/{id}/audio — streamed
    through a backend proxy so the API key never reaches the browser."""
    return f"/api/calls/recording/{conversation_id}"
