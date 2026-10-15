"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { useAccountData } from "@/components/account/use-account-data";
import { errorMessage } from "@/components/shop/errors";
import { useSession } from "@/components/shop/session-provider";
import { api } from "@/lib/api/client";
import type { Quote } from "@/lib/types";

type Body = Record<string, unknown>;

/**
 * One offer and its changes. Every change answers with the whole offer, which replaces the one on screen; the
 * changes go one after another, so a quick series of edits (a quantity, then a markup) lands in that order.
 */
export function useQuote(id: string) {
  const valid = /^\d{1,10}$/.test(id);
  const path = `/api/quotes/${valid ? id : "0"}`;
  const { keepSession } = useSession();
  const { data, error, reload } = useAccountData<Quote>(path);
  const [saved, setSaved] = useState<{ path: string; quote: Quote } | null>(null);
  const [busy, setBusy] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // the last answer of a change wins over the first load
  const quote = saved?.path === path && (!data || saved.quote.updated_at >= data.updated_at) ? saved.quote : data;

  const send = useCallback(
    (method: string, sub: string, body?: Body, failure = "Не удалось сохранить изменения"): Promise<Quote | null> => {
      setBusy((n) => n + 1);
      const run = queue.current.then(async () => {
        try {
          await keepSession();
          const q = await api<Quote>(`${path}${sub}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
          setSaved({ path, quote: q });
          return q;
        } catch (e) {
          toast.error(errorMessage(e, failure));
          return null;
        } finally {
          setBusy((n) => n - 1);
        }
      });
      queue.current = run;
      return run;
    },
    [keepSession, path],
  );

  return {
    valid,
    quote,
    error,
    reload,
    saving: busy > 0,
    patch: (body: Body) => send("PATCH", "", body),
    addLines: (items: Body[]) => send("POST", "/items", { items }, "Не удалось добавить в КП"),
    patchLine: (itemId: number, body: Body) => send("PATCH", `/items/${itemId}`, body),
    removeLine: (itemId: number) => send("DELETE", `/items/${itemId}`, undefined, "Не удалось удалить строку"),
    refreshPrices: () => send("POST", "/refresh", undefined, "Не удалось обновить цены"),
  };
}

export type QuoteApi = ReturnType<typeof useQuote>;
