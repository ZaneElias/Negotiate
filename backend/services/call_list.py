"""
Call-list sourcing — "where the call list comes from in the real world".

Two sources, chosen by which key is configured (Tavily preferred):

  Tavily        — web search across the open web for businesses in a category
                  + location, then OpenAI structures the messy snippets into
                  {name, phone_number, address}. Uses keys most teams already
                  have; no billing account or per-place API to set up.

  Google Places — the New Places Text Search API. Cleaner structured data if
                  you have the key.

Both are optional. With neither configured the frontend falls back to a
manual "type in the companies to call" list — the Caller works identically,
it just doesn't auto-populate. Nothing here fabricates a phone number: a
result with no number is dropped rather than guessed.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List

import httpx

PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
TAVILY_SEARCH_URL = "https://api.tavily.com/search"


class CallListError(RuntimeError):
    pass


async def find_businesses(*, category: str, location_text: str, max_results: int = 8) -> List[Dict[str, Any]]:
    """
    Dispatch to whichever source is configured. Tavily wins if both keys are
    present. Raises CallListError (→ HTTP 503) with an actionable message if
    neither is configured.
    """
    if os.environ.get("TAVILY_API_KEY"):
        return await _find_via_tavily(category=category, location_text=location_text, max_results=max_results)
    if os.environ.get("GOOGLE_PLACES_API_KEY"):
        return await _find_via_google_places(category=category, location_text=location_text, max_results=max_results)
    raise CallListError(
        "No call-list source configured. Set TAVILY_API_KEY (preferred) or GOOGLE_PLACES_API_KEY, "
        "or enter the call list manually in the Calls stage."
    )


# ── Tavily ──────────────────────────────────────────────────────────────────

async def _find_via_tavily(*, category: str, location_text: str, max_results: int) -> List[Dict[str, Any]]:
    api_key = os.environ["TAVILY_API_KEY"]
    query = f"{category} in {location_text} — company name, phone number, address"

    body = {
        "api_key": api_key,
        "query": query,
        "search_depth": "advanced",
        "max_results": min(max(max_results * 2, 6), 20),  # over-fetch; many pages won't carry a phone number
        "include_raw_content": True,
    }

    async with httpx.AsyncClient(timeout=25.0) as http:
        try:
            resp = await http.post(TAVILY_SEARCH_URL, json=body)
        except httpx.HTTPError as exc:
            raise CallListError(f"Failed to reach Tavily: {exc}") from exc

    if resp.status_code >= 400:
        raise CallListError(f"Tavily returned {resp.status_code}: {resp.text[:300]}")

    results = resp.json().get("results", []) or []
    if not results:
        return []

    # Feed the snippets to OpenAI to pull structured businesses out of prose.
    # Imported here (not at module load) to avoid a circular import and to keep
    # call_list usable even if openai isn't installed in a slimmer deployment.
    from services import openai_client

    corpus_parts = []
    for r in results[:12]:
        snippet = (r.get("raw_content") or r.get("content") or "")[:1500]
        corpus_parts.append(f"SOURCE: {r.get('url', '')}\nTITLE: {r.get('title', '')}\n{snippet}")
    corpus = "\n\n---\n\n".join(corpus_parts)

    try:
        businesses = await openai_client.extract_businesses_from_text(
            corpus=corpus,
            category=category,
            location_text=location_text,
            max_results=max_results,
        )
    except openai_client.OpenAIClientError as exc:
        raise CallListError(f"Could not structure Tavily results (needs OPENAI_API_KEY): {exc}") from exc

    # Drop anything without a usable phone number — never a call target we can't dial.
    cleaned: List[Dict[str, Any]] = []
    seen_phones = set()
    for b in businesses:
        phone = (b.get("phone_number") or "").strip()
        if not phone or phone in seen_phones:
            continue
        seen_phones.add(phone)
        cleaned.append({
            "name": (b.get("name") or "Unknown").strip(),
            "phone_number": phone,
            "address": b.get("address"),
            "rating": None,
            "user_rating_count": None,
            "source": "tavily",
            "source_url": b.get("source_url"),
        })
        if len(cleaned) >= max_results:
            break
    return cleaned


# ── Google Places (optional alternate) ──────────────────────────────────────

async def _find_via_google_places(*, category: str, location_text: str, max_results: int) -> List[Dict[str, Any]]:
    api_key = os.environ["GOOGLE_PLACES_API_KEY"]
    body = {"textQuery": f"{category} near {location_text}", "maxResultCount": min(max_results, 20)}
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "places.displayName,places.nationalPhoneNumber,places.formattedAddress,"
            "places.rating,places.userRatingCount"
        ),
    }

    async with httpx.AsyncClient(timeout=15.0) as http:
        try:
            resp = await http.post(PLACES_SEARCH_URL, json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise CallListError(f"Failed to reach Google Places: {exc}") from exc

    if resp.status_code >= 400:
        raise CallListError(f"Google Places returned {resp.status_code}: {resp.text}")

    places = resp.json().get("places", [])
    results = []
    for p in places:
        phone = p.get("nationalPhoneNumber")
        if not phone:
            continue
        results.append({
            "name": p.get("displayName", {}).get("text", "Unknown"),
            "phone_number": phone,
            "address": p.get("formattedAddress"),
            "rating": p.get("rating"),
            "user_rating_count": p.get("userRatingCount"),
            "source": "google_places",
        })
    return results
