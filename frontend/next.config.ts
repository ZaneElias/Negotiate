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
// Baseline security headers. The CSP allows exactly what CallPilot uses: the
// ElevenLabs voice widget (script from unpkg, connections to elevenlabs), the
// same-origin API, and data/blob assets for the WebGL globe. 'unsafe-inline'/
// 'unsafe-eval' are required by Next's runtime + the WebGL/wasm globe; a
// production hardening step would move to per-request nonces.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://*.elevenlabs.io",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.elevenlabs.io wss://*.elevenlabs.io https://unpkg.com",
  "media-src 'self' blob: https://*.elevenlabs.io",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Voice intake needs the mic; nothing else is allowed.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
    return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
  },
};

export default nextConfig;
