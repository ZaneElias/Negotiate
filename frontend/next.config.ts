import type { NextConfig } from "next";

/**
 * The browser only ever calls same-origin `/api/...`. How that reaches the
 * FastAPI backend depends on where we're running:
 *
 *  • Local dev — `next dev` proxies `/api/*` to BACKEND_URL
 *    (default http://127.0.0.1:8000, where `uvicorn main:app` runs).
 *
 *  • Frontend on Vercel + backend on Render (recommended) — set BACKEND_URL in
 *    the Vercel project to the Render service URL; this rewrite proxies to it.
 *    The backend needs a persistent process because state is in-memory and the
 *    agent simulations run for 30–60s per request — neither fits Vercel's
 *    stateless, time-limited serverless functions, so it lives on Render.
 *
 * In every case the frontend code stays origin-agnostic — no localhost-vs-prod
 * branch anywhere in the app.
 */
const nextConfig: NextConfig = {
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
    return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
  },
};

export default nextConfig;
