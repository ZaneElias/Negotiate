# CallPilot — Security Review

Every item from the checklist, mapped to CallPilot's *actual* surface. CallPilot
is a single-session tool: **no database, no user accounts, no payments** by
design, so several items are legitimately N/A (explained, not skipped). Real
issues found were fixed; each fix is noted in plain language with a prevention
step.

## Frontend

| Check | Status | What & why |
|---|---|---|
| Exposed API keys | ✅ Clean | All provider keys (OpenAI/ElevenLabs/Tavily) live in `backend/.env` and are only ever used server-side. Grep of `frontend/src` finds keys **named** in help text, never a value; no `NEXT_PUBLIC_` secret exists. **Prevention:** `.env` is git-ignored; keys can only be added on the backend. |
| No input validation | ✅ Fixed | Added `_sanitize_fields` — the backend now accepts **only** fields defined in the vertical schema, caps string length (2000), clamps/verifies numbers, and caps array size. Applied on *every* intake path (form, voice tool, document). **Prevention:** validation lives in the shared `_merge_fields`, so no intake path can bypass it. |
| Unsafe forms | ✅ Fixed | The intake update used to take an arbitrary `{key: value}` map; now unknown keys are **dropped** server-side. **Prevention:** schema allow-list. |
| Weak password rules | N/A | No passwords or signup. The login screen is a cinematic **entry gate**, not authentication — it collects and stores nothing. |
| Missing error handling | ✅ Fixed | Added a global exception handler that logs the real error server-side and returns a generic `"Something went wrong"` — no stack traces or internals reach the browser. The frontend already shows friendly toasts. |

## App-level

| Check | Status | What & why |
|---|---|---|
| Exposed admin pages | N/A | There are no admin pages or roles. |
| Unsafe redirects | N/A | No redirect logic; the entry gate and nav never redirect to a user- or data-supplied URL. |
| Missing Content-Security-Policy | ✅ Fixed | Added a CSP + `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a `Permissions-Policy` that allows the mic (for voice intake) but blocks camera/geolocation. CSP allows only what's used: same-origin, the ElevenLabs widget, `data:`/`blob:` for the WebGL globe. Verified the app still works with zero CSP violations. |
| Sensitive data in local storage | ✅ Clean | Storage holds only `cp-theme` (light/dark) and a random `job_id`/stage in **sessionStorage**. No tokens, no personal data. |
| No rate limit on public forms | ✅ Fixed | See backend rate limiting. |

## Backend

| Check | Status | What & why |
|---|---|---|
| Broken access control | N/A (noted) | Single-tenant demo: there's no cross-user data model. Jobs are keyed by an unguessable random id. Production would add per-user ownership. |
| No authentication check | N/A (noted) | The API is intentionally open for the demo. Production would put auth in front of the write/expensive routes. |
| SQL injection | N/A | No database and no SQL — state is in-memory Python dicts. |
| Insecure API routes | ✅ Fixed | Every provider route already returns a structured 503 when unconfigured; added validation + rate limiting on top. |
| Exposed environment variables | ✅ Clean | `GET /health` returns only variable **names** that are missing, never values. The audio proxy uses the key server-side so it never reaches the browser. |
| Weak session handling | N/A | No sessions/cookies/tokens. |
| No server-side validation | ✅ Fixed | Pydantic validates every request body; `_sanitize_fields` adds schema + bounds checks. The browser is never trusted. |
| Unsafe file uploads | ✅ Fixed | Uploads were already MIME-whitelisted, size-capped (12 MB), and never written to disk. Added **magic-byte verification** — the actual bytes must be a real PNG/JPEG/WEBP/GIF, so a renamed non-image can't reach the vision model. |
| Missing rate limits | ✅ Fixed | Per-IP sliding-window limits on the paid/expensive endpoints (document upload, calls, negotiate, intake-create) return 429 when exceeded — protects OpenAI/ElevenLabs credits from bots or runaway clients. |
| Poor error messages | ✅ Fixed | Global handler returns generic messages; real detail is logged privately. |
| No logging for suspicious activity | ✅ Fixed | Rate-limit hits and dropped inputs are logged with the source IP. |
| Unprotected payment/checkout | N/A | No payment or checkout logic exists. |

## One honest note for the reader

CallPilot is a hackathon MVP with in-memory state and no auth by design — that's
appropriate for a single-user demo, not a multi-tenant production service. The
fixes above harden the surface that *does* exist (untrusted input, paid-API
abuse, uploads, error leakage, browser headers). Turning this into a product
would add: real authentication + per-user access control, a datastore with
parameterized queries, and secret management — called out here rather than
silently omitted.
