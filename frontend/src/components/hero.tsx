"use client";

import { PhoneCall, Scale, TrendingDown } from "lucide-react";
import { Globe } from "@/components/ui/globe";

/**
 * Landing hero for the Brief stage. Additive branding band above the intake
 * cards — leads with the documented market pain (the 5.6x quote spread) and
 * the three-beat story (Estimate → Call → Close), with the globe as the
 * "one agent, the whole market" visual.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-paper-raised via-paper-raised to-[color-mix(in_srgb,var(--action)_7%,var(--paper-raised))] px-6 py-7 sm:px-8 sm:py-9">
      <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--action)_14%,transparent),transparent_70%)] blur-2xl" />
      <div className="relative grid items-center gap-6 md:grid-cols-[1.4fr_1fr]">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            <span className="size-1.5 rounded-full bg-action" /> ElevenLabs × Hack-Nation · The Negotiator
          </span>
          <h1 className="mt-3 font-serif text-3xl font-semibold leading-[1.1] text-ink sm:text-4xl">
            Never overpay again.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted sm:text-base">
            The same 45-mile move gets quoted anywhere from{" "}
            <span className="font-semibold text-ink">$1,158 to $6,506</span> — a{" "}
            <span className="font-semibold text-ink">5.6× spread</span> for identical work. CallPilot&apos;s voice
            agents call the market, extract itemized quotes, and haggle with real leverage — so you don&apos;t have to.
          </p>
          <div className="mt-5 flex flex-wrap gap-4 text-xs text-ink-muted">
            <Beat icon={<Scale className="size-3.5 text-action" />} label="Estimate" sub="one job spec" />
            <span className="self-center text-line-strong">→</span>
            <Beat icon={<PhoneCall className="size-3.5 text-action" />} label="Call" sub="3 styles, itemized" />
            <span className="self-center text-line-strong">→</span>
            <Beat icon={<TrendingDown className="size-3.5 text-action" />} label="Close" sub="leverage → ranked report" />
          </div>
        </div>
        <div className="hidden justify-self-center md:flex">
          <Globe className="opacity-95" />
        </div>
      </div>
    </section>
  );
}

function Beat({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      <span className="font-medium text-ink">{label}</span>
      <span className="text-ink-muted">· {sub}</span>
    </span>
  );
}
