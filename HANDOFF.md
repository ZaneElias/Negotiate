# CallPilot — Start Here (handoff)

Everything you need to run it, understand it, demo it, and submit. Read top to
bottom; it takes ~10 minutes.

---

## 1. What CallPilot is (say this out loud once)

> **CallPilot is a voice-agent that calls companies, compares their quotes, and haggles for you.**

The problem: the *same* 45-mile move gets quoted anywhere from **$1,158 to $6,506** — a **5.6× spread** for
identical work. The only defense is calling 5–8 movers, describing your job identically each time, and
negotiating. Nobody has the hours. CallPilot's AI voice agent does it: it builds one structured job spec,
calls the market, extracts itemized quotes, negotiates using the best real quote as leverage, and hands you a
ranked report that flags suspiciously-cheap lowballers.

The challenge (ElevenLabs × Hack-Nation, "The Negotiator") asks for exactly three things, and CallPilot does
all three: **Estimate → Call → Close.**

## 2. How it works (the 30-second mental model)

1. **Estimate** — You describe your move (a form, a voice interview, or by uploading a photo/quote that AI reads).
   That becomes **one job spec** you confirm. The same spec is read to every company, so quotes are comparable.
2. **Call** — The AI "Caller" agent negotiates three different personalities: a **tough negotiator**, a
   **stonewaller** who won't quote over the phone, and a **lowballer** who hides fees. It extracts an itemized
   quote from each. These are **real, unscripted ElevenLabs agent conversations** — the price moves on the merits.
3. **Close** — It calls the others back, says *"I have a quote for $X, can you beat it?"* (always a **real** number
   it actually gathered), and reports a ranked comparison with transcripts, red-flags, and a plain-language pick.

**Two modes:** the demo runs in **Simulation** (agent-to-agent via ElevenLabs, no phone bills). Real phone calls
(**Telephony**, Twilio) are fully coded too — we used simulation because Twilio credits were out of budget.

**Tech:** Next.js frontend (the website) → FastAPI backend (Python) → ElevenLabs (voice agents) + OpenAI
(reads documents, writes the recommendation) + Tavily (finds real companies to call).

## 3. Run it (for recording the demo)

Two servers. Easiest: **double-click both `.bat` files** in this folder, leave both windows open, then open
**http://localhost:3000**.

- `run-backend.bat`  → starts the Python backend (port 8000). Wait for "Application startup complete."
- `run-frontend.bat` → starts the website (port 3000). Wait for "Ready", then open the browser.

Your API keys are already saved in `backend/.env` and load automatically. Everything's installed.

> If a `.bat` closes instantly, open PowerShell and run manually:
> `cd backend; .venv\Scripts\python -m uvicorn main:app --port 8000` and in a second window
> `cd frontend; npm run dev`.

## 4. Demo walkthrough (this is your Demo Video, ~2.5 min)

Open http://localhost:3000 and screen-record while you do this. Read the **voiceover** lines aloud.

1. **Entry screen.** *“This is CallPilot.”* Click **Continue as guest**.
2. **The pitch (hero).** *“The same move is quoted $1,158 to $6,506 — 5.6× for identical work. Nobody has time to
   call eight movers. CallPilot does.”*
3. **Estimate.** Fill in a move — e.g. **Rock Hill, SC → Charlotte, NC**, move date, **2 bedrooms**, inventory
   **2br**, **2** flights of stairs at pickup, large items **piano**, packing **self-pack**. (Or upload a photo of
   any moving quote and watch it auto-fill.) Click **Confirm & continue to calls.** *“One job spec, read to every
   company identically — nothing gets called until I confirm.”*
4. **Call.** Keep the three demo personas selected, click **Run 3 agent-to-agent negotiations.** Wait ~40s.
   *“The agent is negotiating three different personalities live.”* When they finish, open a transcript — point out
   the agent **disclosing it's an AI**, and the stonewaller ending in a **callback** instead of a fake number.
5. **Negotiate.** Continue to negotiation, click **Call back with leverage.** *“It calls the others back citing the
   real cheapest quote — watch the price drop.”* Show a price move (e.g. **$1,570 → $1,260**).
6. **Report.** *“Ranked recommendation with transcript evidence — and it red-flags the $745 quote as a lowball,
   not a win.”* Point at the recommended row and the red-flag badge.
7. **Close.** *“It never invents a quote, discloses it's an AI, and swapping movers for medical bills or auto
   repair is one config file.”*

## 5. The three videos

- **Demo Video** — the screen recording above with your voiceover. (This is the important one.)
- **Tech Video** — talk over the code/README for ~2 min. Talking points: Next.js + FastAPI; one job spec reused
  verbatim; the clever part = we run the *real* ElevenLabs Caller agent via the simulation API and read its quote
  from the transcript (genuine, unscripted, free); honesty is enforced because the leverage number is a real prior
  quote passed in; `provision_agents.py` sets up the agents in one command; one YAML file swaps the whole vertical.
  (Full notes in `SUBMISSION.md`.)
- **Team Video** — who you are and why you picked this. Keep it personal and short.

## 6. What to submit at projects.hack-nation.ai

| Item | What to upload |
|---|---|
| Project Summary (150–300 words) | Copy from **`PROJECT_SUMMARY.md`** |
| Demo Video | Your screen recording (section 4) |
| Tech Video | Your code walkthrough (section 5) |
| Team Video | Your intro |
| GitHub Repository | **https://github.com/ZaneElias/Negotiate** |
| Zipped Code | **`C:\Users\zanel\Downloads\callpilot-submission.zip`** |
| Dataset | **N/A** — grounded in public FMCSA/moveBuddha price benchmarks + live Tavily search; no trained dataset |

**A live deployed URL is NOT on this list** — you do not need to deploy to submit. The Demo Video is the proof.
Deployment steps (optional) are in `README.md` under "Deploying".
