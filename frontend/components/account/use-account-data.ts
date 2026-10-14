"use client";

import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/components/shop/session-provider";
import { api } from "@/lib/api/client";

/**
 * GET of the signed-in customer's own data (orders and the like) from the browser, after making sure
 * the session is alive. `error` holds the failure (an ApiError for 404 and the like) until `reload`.
 */
export function useAccountData<T>(path: string) {
  const { keepSession } = useSession();
  const [result, setResult] = useState<{ path: string; data: T | null; error: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    keepSession()
      .then(() => api<T>(path))
      .then(
        (data) => alive && setResult({ path, data, error: null }),
        (error: unknown) => alive && setResult({ path, data: null, error }),
      );
    return () => {
      alive = false;
    };
  }, [keepSession, path, attempt]);

  // a result for another path (the page moved on) does not count
  const current = result?.path === path ? result : null;
  const reload = useCallback(() => {
    setResult(null);
    setAttempt((n) => n + 1);
  }, []);
  return { data: current?.data ?? null, error: current?.error ?? null, reload };
}
