"use client";

import { useEffect, useState } from "react";

import type { CategoryNode } from "@/lib/types";

// The catalog menus load three levels of the category tree on first open (~100 KB, cached by
// the browser for the rest of the visit) instead of embedding it into every page.
let request: Promise<CategoryNode[]> | null = null;

export function loadCategoryTree(): Promise<CategoryNode[]> {
  request ??= fetch("/api/categories?depth=3")
    .then((r) => (r.ok ? (r.json() as Promise<CategoryNode[]>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((e: unknown) => {
      request = null; // allow a retry
      throw e;
    });
  return request;
}

export function useCategoryTree(enabled: boolean) {
  const [state, setState] = useState<{ tree: CategoryNode[] | null; error: boolean; attempt: number }>({
    tree: null,
    error: false,
    attempt: 0,
  });

  useEffect(() => {
    if (!enabled || state.tree) return;
    let cancelled = false;
    loadCategoryTree().then(
      (tree) => !cancelled && setState((s) => ({ ...s, tree, error: false })),
      () => !cancelled && setState((s) => ({ ...s, error: true })),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, state.tree, state.attempt]);

  const retry = () => setState((s) => ({ ...s, error: false, attempt: s.attempt + 1 }));
  return { tree: state.tree, error: state.error, retry };
}
