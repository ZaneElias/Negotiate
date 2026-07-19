"use client";

import { useRef, useState } from "react";
import { PhoneCall, ArrowRight } from "lucide-react";
import { Globe } from "@/components/ui/globe";

/**
 * Cinematic entry screen. This is an *entry gate*, not authentication — both
 * buttons simply enter the demo (CallPilot has no accounts). The design is
 * intentionally always-dark for a filmic first impression, independent of the
 * app's light/dark toggle. No credentials are collected or stored.
 */
export function LoginScreen({ onEnter }: { onEnter: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [glow, setGlow] = useState({ x: -400, y: -400, on: false });

  function onMove(e: React.MouseEvent) {
    const r = panelRef.current?.getBoundingClientRect();
    if (!r) return;
    setGlow({ x: e.clientX - r.left, y: e.clientY - r.top, on: true });
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07090f] p-4 text-white">
      {/* ambient cinematic gradients */}
      <div className="pointer-events-none absolute -left-40 -top-40 size-[36rem] rounded-full bg-[radial-gradient(circle,rgba(91,131,255,0.22),transparent_65%)] blur-2xl" />
      <div className="pointer-events-none absolute -bottom-52 -right-32 size-[40rem] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.16),transparent_65%)] blur-2xl" />

      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl backdrop-blur-xl md:grid-cols-2">
        {/* left: brand + entry */}
        <div
          ref={panelRef}
          onMouseMove={onMove}
          onMouseLeave={() => setGlow((g) => ({ ...g, on: false }))}
          className="relative flex flex-col justify-center gap-6 px-8 py-12 sm:px-12"
        >
          <div
            className="pointer-events-none absolute size-72 rounded-full bg-[radial-gradient(circle,rgba(120,150,255,0.16),transparent_70%)] blur-2xl transition-opacity duration-200"
            style={{ left: glow.x - 144, top: glow.y - 144, opacity: glow.on ? 1 : 0 }}
          />
          <div className="relative flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-[#5b83ff] text-white">
              <PhoneCall className="size-4" />
            </div>
            <span className="font-serif text-lg font-semibold tracking-tight">CallPilot</span>
          </div>

          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-white/70">
              <span className="size-1.5 rounded-full bg-[#5b83ff]" /> The Negotiator · ElevenLabs × Hack-Nation
            </span>
            <h1 className="mt-4 font-serif text-3xl font-semibold leading-[1.1] sm:text-4xl">
              Never overpay again.
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/65">
              Voice agents that call the market, compare itemized quotes, and haggle with real leverage — so you
              don&apos;t have to.
            </p>
          </div>

          <div className="relative flex flex-col gap-3">
            <button
              onClick={onEnter}
              className="group inline-flex h-11 items-center justify-center gap-3 rounded-lg bg-white px-4 text-sm font-medium text-[#0b0f17] transition-transform hover:scale-[1.01]"
            >
              <GoogleIcon /> Continue with Google
            </button>
            <button
              onClick={onEnter}
              className="group inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-medium text-white/90 transition-colors hover:border-[#5b83ff]/60 hover:bg-white/10"
            >
              Continue as guest
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <p className="text-center text-[11px] text-white/40">
              Demo mode — no account needed. Nothing is stored beyond this browser session.
            </p>
          </div>
        </div>

        {/* right: the globe — "one agent, the whole market" */}
        <div className="relative hidden items-center justify-center border-l border-white/10 bg-[radial-gradient(circle_at_50%_40%,rgba(91,131,255,0.12),transparent_70%)] md:flex">
          <div className="w-[78%]">
            <Globe />
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.389-7.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.389-7.917z" />
    </svg>
  );
}
