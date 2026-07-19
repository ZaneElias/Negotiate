# CallPilot — Deploy Guide (free)

**Frontend → Vercel, Backend → Render.** ~20 minutes with your own accounts. The backend must run on Render
(not Vercel) because its state is in-memory and simulations run 30–60s — that needs a persistent process, which
Vercel's serverless functions aren't. Do the **backend first** (you need its URL for the frontend).

> A live URL is **not required** to submit — this is optional polish. Don't risk your deadline on it.

---

## Part A — Backend on Render

1. Go to **render.com**, sign up with **GitHub**, authorize access to the `Negotiate` repo.
2. **New +** → **Web Service** → pick **`ZaneElias/Negotiate`**.
3. Settings:
   - **Root Directory:** `backend`
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** **Free**
4. **Environment → Add Environment Variable** for each of these (copy the values from your local
   `backend/.env`):
   - `CALL_MODE` = `simulation`
   - `OPENAI_API_KEY` = *(your key)*
   - `ELEVENLABS_API_KEY` = *(your key)*
   - `ELEVENLABS_CALLER_AGENT_ID` = `agent_2001kxw02xmpehr9jdqe6pf9z03y`
   - `ELEVENLABS_INTERVIEW_AGENT_ID` = `agent_6201kxw030gsejebg0dn4hfcted7`
   - `TAVILY_API_KEY` = *(your key)*
5. **Create Web Service.** Wait for the build to go live.
6. Copy the URL (e.g. `https://callpilot-backend.onrender.com`). Open **`<that-url>/health`** — you should see
   JSON with `"ready_for_calls": true`. ✅ Backend done.

*(Shortcut: Render can also read the included `render.yaml` via **New + → Blueprint** — it pre-fills everything;
you just paste the secret values.)*

## Part B — Frontend on Vercel

1. Go to **vercel.com**, sign up with **GitHub**.
2. **Add New… → Project** → import **`ZaneElias/Negotiate`**.
3. **Root Directory:** click **Edit** → select **`frontend`**. (Framework auto-detects as Next.js.)
4. **Environment Variables:** add **`BACKEND_URL`** = your Render URL from A6 (no trailing slash).
5. **Deploy.** Open the Vercel URL — that's your live CallPilot.

## After deploy

- **Warm it up before you demo/show it:** on the free tier the backend sleeps after ~15 min idle, so the first
  request takes ~50s. Load the site once and click through before recording or sharing the link.
- A backend restart clears in-memory jobs; the app shows a clean "session expired — start a new job" state.
- CORS is open by default (`CORS_ALLOW_ORIGINS=*`). To lock it down, set that on Render to your Vercel origin.
