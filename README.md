# CallPilot

An end-to-end MVP for **THE NEGOTIATOR** (ElevenLabs × Hack-Nation, 6th Global AI Hackathon): a voice-agent
system that gathers real moving-company quotes, reports them in comparable form, negotiates with genuine
leverage, and returns a ranked recommendation backed by transcript evidence.

Vertical: **moving** — config-driven. Retargeting to auto repair, contractor bids, medical bills, etc. means
adding one YAML file in `backend/configs/`, not touching application code.

## The one thing that makes this demoable in five minutes

Two ways to run "the other end of the phone", both real, both allowed by the brief:

- **Simulation (default, zero setup beyond keys).** The *real* Caller agent — its actual system prompt and
  `log_quote` tool — negotiates against each counterparty persona through ElevenLabs' agent-simulation API.
  These are genuine, unscripted agent-to-agent conversations: the Caller reasons, the counterparty pushes
  back, and the price moves (or doesn't) **on the merits**. No Twilio, no phone numbers, no public webhook —
  and it's fully reproducible for judging. The quote is read straight from the returned transcript's tool call.
- **Telephony (real voice).** The same Caller agent places real outbound calls over Twilio/SIP with playable
  recordings. Flip `CALL_MODE=telephony` and add a caller phone number registered in ElevenLabs — that's it;
  quotes are captured from the polled call transcript, so no public `WEBHOOK_BASE_URL` is required for a demo
  (the human-in-the-loop path: the Caller phones you, you role-play each counterparty; recordings play in the UI).

You are never more than one command from a working demo:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # fill in OPENAI_API_KEY, ELEVENLABS_API_KEY, TAVILY_API_KEY
python scripts/provision_agents.py   # creates the agents + tools, prints the agent IDs
# paste the printed ELEVENLABS_*_AGENT_ID values into .env, then:
uvicorn main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Intake (voice-form fallback + document upload) works with zero configuration. In the default **simulation**
mode, placing calls needs only `ELEVENLABS_API_KEY` + the created `ELEVENLABS_CALLER_AGENT_ID`.

### `scripts/provision_agents.py`

Does the whole ElevenLabs setup for you, idempotently:

- creates the `log_quote` and `log_intake_field` **webhook tools** pointed at your `WEBHOOK_BASE_URL`;
- creates the **Caller** agent (`prompts/caller_agent.md`) and the **Estimator interview** agent
  (`prompts/interview_agent.md`), attaching the right tool to each;
- `--counterparties` also creates the three telephony demo-persona agents;
- prints the exact `ELEVENLABS_*_AGENT_ID` lines to paste into `.env`.

Re-running reuses anything that already exists by name. `--dry-run` shows what it would do.

## Architecture

- `frontend/` — Next.js 16 (App Router, TypeScript, Tailwind v4). Four-stage flow: Brief → Calls → Negotiate
  → Report. The browser only ever calls same-origin `/api/...`; `next.config.ts` proxies that to `BACKEND_URL`.
- `backend/` — FastAPI. **Estimator** (intake), **Caller** (simulation or telephony), **Closer** (negotiation +
  report). State is in-memory by design (hackathon scale); a restart clears jobs and the frontend surfaces that
  as a clean "start a new job" state.

**Nothing here fakes a working integration.** Every route that needs a provider checks configuration first and
returns a clear 503 naming the missing variables — never synthesized demo data. `GET /api/health` reports
exactly what's missing per mode, by name, without ever exposing a secret; the frontend renders it as a blocking
setup panel.

## Configuration

| Variable | Needed for | Purpose |
|---|---|---|
| `CALL_MODE` | all | `simulation` (default) or `telephony`. |
| `OPENAI_API_KEY` | all | Document/photo extraction (vision), call-list structuring, final recommendation. |
| `ELEVENLABS_API_KEY` | all | Agent simulations (simulation) / placing + polling calls (telephony). |
| `ELEVENLABS_CALLER_AGENT_ID` | all | The Caller agent — created by `provision_agents.py`. |
| `TAVILY_API_KEY` | optional | Real-world call-list sourcing via web search (preferred over Google Places). |
| `ELEVENLABS_INTERVIEW_AGENT_ID` | optional | Live voice intake. Manual-form + document intake work without it. |
| `ELEVENLABS_CALLER_PHONE_NUMBER_ID` | telephony | The Twilio/SIP number the Caller dials from. |
| `WEBHOOK_BASE_URL` | optional | Public URL for the agent's `log_quote` webhook (real-time capture). Without it, quotes are read from the polled transcript, so a local telephony demo needs no ngrok. |
| `COUNTERPARTY_*_NUMBER` | telephony (demo) | Numbers for the three telephony demo personas. |

Full descriptions in `backend/.env.example`.

## Deploying (recommended: Vercel frontend + Render backend)

The backend needs a **persistent process** — its state is in-memory and each simulation runs 30–60s per
request, neither of which fits Vercel's stateless, time-limited serverless functions. So:

- **Backend → Render.** `render.yaml` is a ready blueprint (persistent web service, `/health` check). Set the
  secret env vars in the dashboard. Use a paid instance so it stays warm (free tier spins down and loses state).
- **Frontend → Vercel.** Set the project's Root Directory to `frontend` and add `BACKEND_URL` = your Render URL.
  The Next.js rewrite proxies `/api/*` to it. Set the backend's `CORS_ALLOW_ORIGINS` to your Vercel origin.

## Mapping to the challenge brief

| Requirement | Where |
|---|---|
| Voice interview intake (ElevenLabs Agents) | `prompts/interview_agent.md` + `<elevenlabs-convai>` widget, → `POST /intake/{job}/voice-tool` |
| Document intake, same schema | `POST /intake/{job}/document` → `services/openai_client.py` vision extraction |
| One job spec, confirmed, reused verbatim | `JobSpec.as_call_context()` — one coerced dict, fed to every call; `confirmed` freezes it |
| 3+ distinct negotiation styles | `configs/moving.yaml: counterparty_styles` + `prompts/counterparty_*.md`; simulation runs all three |
| Live calls, itemized comparable quotes | `POST /calls/{job}/simulate` (agent-to-agent) or `/calls/{job}/start` (telephony); `log_quote` → `Quote`/`LineItem` |
| Real call-list sourcing | `services/call_list.py` — Tavily (preferred) or Google Places, manual fallback |
| Price moves from real leverage | `POST /negotiate/{job}/simulate` (or `/start`) cites the actual cheapest gathered quote — never a fabricated number |
| Red-flag rule (30% under market) | `configs/moving.yaml: red_flag_rules` + `_apply_red_flags()` |
| Ranked report, transcript evidence | `GET /report/{job}`, `ReportStage` (table on desktop, cards on mobile) |
| AI discloses itself, never fabricates | `caller_agent.md` "Identity and disclosure" + "Honesty constraints" |
| Config-driven vertical swap | `configs/moving.yaml` is the only file a new vertical needs |

## How the four conversation requirements are handled

- **Who is the agent speaking for?** The Caller volunteers "I'm an AI assistant calling on a customer's behalf"
  in its opener and, if asked "am I talking to a robot?", confirms plainly and pivots back to the quote —
  `prompts/caller_agent.md` "Identity and disclosure".
- **Surviving friction.** The Stonewaller persona interrupts, multitasks, and refuses to quote sight-unseen; the
  Caller works past it to a rough range or a structured callback — never a vague "around two thousand".
- **The honesty line.** The Caller may only cite a competing quote that was actually gathered
  (`{{leverage_quote_total}}`), never inventing inventory or a fake bid — enforced in the prompt and by the fact
  that the leverage number is passed in from a real prior quote, not generated.
- **Every call ends structured.** `log_quote` records exactly one outcome — itemized quote, callback commitment,
  or documented decline — captured from the transcript (simulation) or the live webhook (telephony).

## What's in-memory / what I'd revisit for production

Persistence (a restart clears jobs), a real audio archive beyond the session, multi-vertical config loaded
simultaneously, and a smarter negotiation-target policy than "cheapest becomes leverage, call back the rest."
