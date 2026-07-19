# CallPilot — Submission Guide

Deliverables checklist for **projects.hack-nation.ai** and how each is satisfied.

| Item | Status | Notes |
|---|---|---|
| Project Summary (150–300 words) | Ready | See `PROJECT_SUMMARY.md` — paste into the form. |
| Demo Video | Record | Script below. |
| Tech Video | Record | Talking points below. |
| Team Video | Record | Who you are / why this. |
| GitHub Repository (public) | Done | https://github.com/ZaneElias/Negotiate |
| Zipped Code | Done | `callpilot-submission.zip` (source only, no secrets/deps). |
| Dataset | N/A (grounded, not trained) | Price benchmarks in `backend/configs/moving.yaml` (FMCSA + moveBuddha); call list sourced live via Tavily. No trained dataset. |

## A note on telephony (be upfront)

CallPilot ships **both** ways to run "the other end of the phone", both allowed by the brief:

- **Simulation (what the demo shows):** the *real* Caller agent negotiates each counterparty persona through ElevenLabs' agent-simulation API — genuine, unscripted, reproducible, and free. This is what's recorded in the demo.
- **Real Twilio voice (fully wired, not shown):** `CALL_MODE=telephony` places real outbound calls; a number is already registered in ElevenLabs and quotes/recordings are captured from the transcript. We didn't record this path because **paid telephony credits were out of budget** for the hackathon — it's code-complete, not a stub.

This is an honest tradeoff, not a gap: the negotiation *reasoning* — the part the brief says the challenge is won on — is identical on both paths.

## Demo Video script (~2–3 min)

1. **Hook (15s).** Landing hero: "The same move is quoted $1,158 to $6,506 — 5.6× for identical work. Nobody has time to call 8 movers. CallPilot does."
2. **Estimate (30s).** Fill the move (Rock Hill → Charlotte, 2BR, piano, 2 flights of stairs), or upload a photo/quote and show it auto-extract into the same spec. Confirm it — "nothing gets called until you confirm."
3. **Call (45s).** Add the 3 personas, run. Show the three calls completing with **itemized** quotes. Open a transcript — point out the agent disclosing it's an AI, and the stonewaller ending in a callback (friction handled).
4. **Close (45s).** Run the negotiation callback. Show a **price actually drop** (e.g. Summit $1,895 → $1,295) because it cited the real cheapest quote. Open the report: ranked table, the lowballer **red-flagged** as below-market, plain-language recommendation.
5. **Close-out (15s).** "One YAML file swaps movers for auto-repair or medical bills. It never fabricates a quote, discloses it's an AI, and ends every call structured."

## Tech Video talking points (~2–3 min)

- **Architecture:** Next.js 16 frontend → FastAPI backend; Estimator / Caller / Closer. `GET /health` gates every provider with named-variable 503s — nothing is faked.
- **One spec, reused verbatim:** `JobSpec.as_call_context()` — the same coerced dict fed to every call; `confirmed` freezes it. Voice interview and document intake produce the identical shape.
- **The clever bit:** simulation runs the *real* Caller agent (its actual prompt + `log_quote` tool) via `agents.simulate_conversation`, reading the quote straight from the transcript's tool call — genuine agent-to-agent, zero telephony cost, reproducible for judging.
- **Honesty by construction:** the negotiation leverage number is a real prior `Quote.total_price`, passed in — the agent *can't* cite a bid that wasn't gathered. Red flags (`_apply_red_flags`) implement all four `moving.yaml` rules.
- **One-command setup:** `scripts/provision_agents.py` creates the agents + webhook tools via the ElevenLabs API and prints the IDs.
- **Config-driven vertical:** `configs/moving.yaml` is the only vertical-specific file.
