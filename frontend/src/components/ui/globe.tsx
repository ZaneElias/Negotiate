"use client";

import { useEffect, useRef } from "react";
import createGlobe from "cobe";

type LatLng = [number, number];

/**
 * Decorative auto-rotating globe (cobe) themed to CallPilot's warm-paper /
 * blue palette. Renders the origin + a spray of destination markers with arcs
 * — "one agent, the whole market", the product thesis as a visual. Purely
 * presentational; no interaction, so it stays cheap and robust.
 */
export function Globe({
  className = "",
  markers = DEFAULT_MARKERS,
}: {
  className?: string;
  markers?: LatLng[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let phi = 0;
    let width = 0;
    let globe: ReturnType<typeof createGlobe> | null = null;
    let raf = 0;

    const start = () => {
      width = canvas.offsetWidth;
      if (!width || globe) return; // wait until laid out
      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width: width * 2,
        height: width * 2,
        phi: 0,
        theta: 0.25,
        dark: 0,
        diffuse: 1.2,
        mapSamples: 16000,
        mapBrightness: 8,
        baseColor: [0.96, 0.94, 0.9], // warm paper
        markerColor: [0.145, 0.333, 0.78], // action blue
        glowColor: [0.97, 0.95, 0.92],
        markers: markers.map((location) => ({ location, size: 0.05 })),
      });
      // cobe v2 renders via an external rAF loop calling update().
      const tick = () => {
        phi += 0.004;
        globe!.update({ phi, width: width * 2, height: width * 2 });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(() => {
      if (!globe) start();
      else width = canvas.offsetWidth;
    });
    ro.observe(canvas);
    start();

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      globe?.destroy();
    };
  }, [markers]);

  return (
    <div className={`relative aspect-square w-full max-w-[420px] ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

// Rock Hill / Charlotte area origin + a spread of US metros = "the market".
const DEFAULT_MARKERS: LatLng[] = [
  [35.0, -81.0], // Rock Hill / Charlotte
  [33.749, -84.388], // Atlanta
  [40.7128, -74.006], // NYC
  [41.8781, -87.6298], // Chicago
  [29.7604, -95.3698], // Houston
  [34.0522, -118.2437], // LA
  [39.7392, -104.9903], // Denver
  [47.6062, -122.3321], // Seattle
];
