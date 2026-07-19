"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UsePollingOptions<T> {
  fn: () => Promise<T>;
  intervalMs?: number;
  active: boolean;
  onError?: (err: unknown) => void;
}

interface UsePollingResult<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  retry: () => void;
}

/**
 * Polls `fn` every `intervalMs` while `active` is true. Stops automatically
 * when `active` flips false (e.g. all calls reached a terminal state) or on
 * unmount. Exposes `retry()` for a manual one-shot refetch on transient
 * failure without restarting the interval.
 */
export function usePolling<T>({ fn, intervalMs = 3000, active, onError }: UsePollingOptions<T>): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const fnRef = useRef(fn);
  const onErrorRef = useRef(onError);

  // Refs must be written after render (in an effect), not during render.
  useEffect(() => {
    fnRef.current = fn;
    onErrorRef.current = onError;
  });

  const runOnce = useCallback(async () => {
    try {
      const result = await fnRef.current();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err);
      onErrorRef.current?.(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      await runOnce();
      if (!cancelled && active) {
        timer = setTimeout(tick, intervalMs);
      }
    };

    // `loading` already starts true via useState(true) above, so the first
    // run doesn't need a synchronous setState here — tick() sets it false
    // in its own finally block once the first fetch resolves.
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, intervalMs, runOnce]);

  return { data, loading, error, retry: () => { setLoading(true); runOnce(); } };
}
