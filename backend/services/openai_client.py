"""
OpenAI integration for CallPilot.

Two jobs only:
  1. extract_job_spec_from_document() — vision extraction of an uploaded
     photo/PDF/quote into the vertical's job_spec_schema shape.
  2. generate_recommendation() — the final plain-language, evidence-cited
     recommendation for the report.

Both raise on failure (missing key, provider error, malformed response)
rather than silently returning placeholder data. Model names are
env-configurable because they go stale fast — check
https://platform.openai.com/docs/models before a live run and set
OPENAI_TEXT_MODEL / OPENAI_VISION_MODEL if the defaults below are outdated.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any, Dict, List

from openai import AsyncOpenAI, OpenAIError

DEFAULT_VISION_MODEL = os.environ.get("OPENAI_VISION_MODEL", "gpt-4o")
DEFAULT_TEXT_MODEL = os.environ.get("OPENAI_TEXT_MODEL", "gpt-4o")

SUPPORTED_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}


class OpenAIClientError(RuntimeError):
    """Wraps provider/config errors into a message safe to surface as an HTTP 502/503."""


def _get_client() -> AsyncOpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise OpenAIClientError("OPENAI_API_KEY is not configured.")
    return AsyncOpenAI(api_key=api_key)


async def extract_job_spec_from_document(
    *,
    file_bytes: bytes,
    mime_type: str,
    vertical_schema: Dict[str, Any],
    vertical_name: str,
) -> Dict[str, Any]:
    """
    Vision-extract structured job-spec fields from an uploaded image
    (photo of a room, an existing quote, an inventory list, a bill).

    Returns {"fields": {...}, "needs_review": [...]} — same shape the
    voice-interview path produces, so both merge into JobSpec.fields
    identically.

    PDF documents should be rasterized to page images by the caller before
    this is invoked (OpenAI's vision input takes images, not raw PDF bytes).
    """
    if mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
        raise OpenAIClientError(
            f"Unsupported document MIME type '{mime_type}'. "
            f"Supported: {', '.join(sorted(SUPPORTED_IMAGE_MIME_TYPES))}. "
            f"Rasterize PDFs to PNG/JPEG pages before upload."
        )

    client = _get_client()
    b64 = base64.b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"

    schema_hint = json.dumps(vertical_schema, indent=2)
    system_prompt = (
        f"You extract structured job-spec data for a '{vertical_name}' price-quoting assistant. "
        f"You are given a photo, screenshot, or scanned document (an inventory, an existing "
        f"quote, a bill, or similar). Extract ONLY what is visible or explicitly stated in the "
        f"image — never invent, estimate, or assume a value that is not evidenced in the image. "
        f"The target field shape for this vertical is:\n{schema_hint}\n\n"
        f"Respond ONLY with JSON of the form:\n"
        f'{{"fields": {{...matching the shape above, omitting fields you could not read...}}, '
        f'"needs_review": ["short note on anything ambiguous, illegible, or uncertain"]}}\n'
        f"No prose, no markdown fences, JSON only."
    )

    try:
        response = await client.chat.completions.create(
            model=DEFAULT_VISION_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extract the job spec from this document."},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
    except OpenAIError as exc:
        raise OpenAIClientError(f"OpenAI vision extraction failed: {exc}") from exc

    raw = response.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OpenAIClientError(f"OpenAI returned non-JSON extraction output: {exc}") from exc

    parsed.setdefault("fields", {})
    parsed.setdefault("needs_review", [])
    return parsed


async def extract_businesses_from_text(
    *,
    corpus: str,
    category: str,
    location_text: str,
    max_results: int,
) -> List[Dict[str, Any]]:
    """
    Structure messy web-search snippets (from Tavily) into a call list of
    {name, phone_number, address, source_url}. Extraction only — never
    invents a business or a phone number that isn't present in the corpus.
    A result with no phone number in the text is omitted, not guessed.
    """
    client = _get_client()

    system_prompt = (
        f"You build a call list of '{category}' businesses in or near '{location_text}' from raw "
        f"web-search excerpts. Extract ONLY businesses whose phone number is literally present in "
        f"the text — never invent, complete, or guess a phone number, name, or address. Prefer local "
        f"businesses that actually serve this area. Return at most {max_results} distinct businesses, "
        f"de-duplicated by phone number.\n\n"
        f"Respond ONLY with JSON of the form:\n"
        f'{{"businesses": [{{"name": "...", "phone_number": "...", "address": "... or null", '
        f'"source_url": "... or null"}}]}}\n'
        f"Use the exact phone-number digits/formatting as they appear in the text. No prose, JSON only."
    )

    try:
        response = await client.chat.completions.create(
            model=DEFAULT_TEXT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": corpus[:24000]},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
    except OpenAIError as exc:
        raise OpenAIClientError(f"OpenAI business extraction failed: {exc}") from exc

    raw = response.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OpenAIClientError(f"OpenAI returned non-JSON business list: {exc}") from exc

    businesses = parsed.get("businesses", [])
    return businesses if isinstance(businesses, list) else []


async def generate_recommendation(
    *,
    job_fields: Dict[str, Any],
    quotes: List[Dict[str, Any]],
    red_flags: List[str],
) -> str:
    """
    Produce the final plain-language recommendation. Must ground every claim
    in the quotes/red_flags actually passed in — the prompt explicitly
    forbids inventing numbers or companies not present in the input.
    """
    client = _get_client()

    user_payload = json.dumps(
        {"job": job_fields, "quotes": quotes, "red_flags": red_flags}, indent=2, default=str
    )
    system_prompt = (
        "You are the final-report writer for CallPilot, a voice-agent price-negotiation tool. "
        "You are given the confirmed job spec, every quote actually gathered by phone (with "
        "itemized fees, outcome, and negotiation notes), and any red flags already detected. "
        "Write a short (150-250 word) plain-language recommendation: which quote to take and why, "
        "referencing specific numbers and company names from the input. Call out any red-flagged "
        "quote explicitly and explain why it's risky rather than simply cheap. Never invent a "
        "company, price, or fee that is not in the input JSON. If the data is too thin to "
        "recommend confidently (e.g. only one usable quote), say so plainly instead of overstating "
        "confidence."
    )

    try:
        response = await client.chat.completions.create(
            model=DEFAULT_TEXT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_payload},
            ],
            temperature=0.3,
        )
    except OpenAIError as exc:
        raise OpenAIClientError(f"OpenAI recommendation generation failed: {exc}") from exc

    return (response.choices[0].message.content or "").strip()
