"use client";

import { useEffect, useSyncExternalStore } from "react";

import { useCart, useSession } from "@/components/shop/session-provider";
import { api } from "@/lib/api/client";
import type { BuyerPrices, PaymentMethod } from "@/lib/types";

// Prices of the products on screen for the client's organization. Catalog pages are rendered on the
// server without prices, the same for everyone (and cached): the site sells to businesses only, and
// a client's browser takes their organization's prices from the API. Every price asks for its
// product, and the products of one render go in a single request.

export type Prices = Record<PaymentMethod, number | null>;

const TTL = 5 * 60_000; // prices change with the stock sync every 30 minutes
const BATCH = 200; // GET /api/cart/prices takes up to 200 products

type Known = { at: number; prices: Map<number, Prices | null> }; // null: the product is not sold
const known = new Map<number, Known>(); // organization id ->
const waiting = new Map<number, Set<number>>(); // organization id -> skus to ask for
const failed = new Set<string>(); // `${org}:${sku}`: not asked again until the page is reloaded
let version = 0;
const listeners = new Set<() => void>();

function changed() {
  version++;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function lookup(org: number, sku: number): Prices | null | undefined {
  const k = known.get(org);
  if (k && Date.now() - k.at > TTL) known.delete(org);
  return known.get(org)?.prices.get(sku);
}

function ask(org: number, sku: number) {
  const queue = waiting.get(org) ?? new Set<number>();
  if (!queue.size) {
    waiting.set(org, queue);
    setTimeout(() => void flush(org), 0); // after the whole render has asked
  }
  queue.add(sku);
}

async function flush(org: number) {
  const skus = [...(waiting.get(org) ?? [])];
  waiting.delete(org);
  for (let i = 0; i < skus.length; i += BATCH) {
    const chunk = skus.slice(i, i + BATCH);
    try {
      const res = await api<BuyerPrices>(`/api/cart/prices?${chunk.map((s) => `sku=${s}`).join("&")}`);
      const k = known.get(org) ?? { at: Date.now(), prices: new Map() };
      known.set(org, k);
      for (const sku of chunk) k.prices.set(sku, res.prices[sku] ?? null);
    } catch {
      chunk.forEach((sku) => failed.add(`${org}:${sku}`));
    }
    changed();
  }
}

/**
 * The product's prices for the client's organization: `loading` until they arrive, `prices: null` for a
 * product without one. `null`: no prices for this visitor (a guest, an organization not checked yet), or
 * they could not be loaded.
 */
export function useBuyerPrices(sku: number): { loading: true } | { loading: false; prices: Prices | null } | null {
  const { access } = useSession();
  const { cart, error } = useCart();
  const org = access === "client" ? (cart?.organization.id ?? null) : null;
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  const value = org == null ? undefined : lookup(org, sku);
  const missing = org != null && value === undefined && !failed.has(`${org}:${sku}`);

  useEffect(() => {
    if (missing) ask(org, sku);
  }, [missing, org, sku]);

  // a client whose cart (and so the organization) is still loading
  if (org == null) return (access === "client" && !error) || access === "loading" ? { loading: true } : null;
  if (value === undefined && !missing) return null;
  return value === undefined ? { loading: true } : { loading: false, prices: value };
}
