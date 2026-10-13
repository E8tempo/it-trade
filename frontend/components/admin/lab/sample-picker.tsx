"use client";

import { LoaderCircle, Search, Shuffle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorText } from "@/lib/admin/errors";
import { variantLabel } from "@/lib/admin/labels";
import type { LabSample, LabSampleGroup } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { useDebounced } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const PAGE = 8; // photos per variant, and per click on "ещё"

function samplesUrl(q: string, seed: number | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ per_variant: String(PAGE), ...extra });
  if (q) params.set("q", q);
  if (seed !== null) params.set("seed", String(seed));
  return `/api/admin/lab/watermark/samples?${params}`;
}

/** Processed catalog photos grouped by watermark variant: newest first or shuffled, searchable, each group growing on demand. */
export function SamplePicker({
  initial,
  activeId,
  disabled,
  onPick,
}: {
  initial: LabSampleGroup[];
  activeId: number | null;
  disabled: boolean;
  onPick: (s: LabSample) => void;
}) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const [seed, setSeed] = useState<number | null>(null);
  // the groups and the query they were loaded for: a newer query shows the old groups dimmed until it arrives
  const [data, setData] = useState<{ key: string; groups: LabSampleGroup[]; error: string | null }>({
    key: "|",
    groups: initial,
    error: null,
  });
  const [extending, setExtending] = useState<string | null>(null);
  const key = `${q}|${seed ?? ""}`;
  const pending = data.key !== key;

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    api<LabSampleGroup[]>(samplesUrl(q, seed))
      .then((groups) => !cancelled && setData({ key, groups, error: null }))
      .catch((e) => !cancelled && setData((d) => ({ ...d, key, error: apiErrorText(e) })));
    return () => {
      cancelled = true;
    };
  }, [key, pending, q, seed]);

  async function more(g: LabSampleGroup) {
    setExtending(g.variant);
    const at = data.key;
    try {
      const [next] = await api<LabSampleGroup[]>(samplesUrl(q, seed, { variant: g.variant, offset: String(g.items.length) }));
      const shown = new Set(g.items.map((s) => s.image_id));
      const items = [...g.items, ...(next?.items ?? []).filter((s) => !shown.has(s.image_id))];
      setData((d) =>
        d.key !== at // the search changed meanwhile
          ? d
          : { ...d, groups: d.groups.map((x) => (x.variant === g.variant ? { ...x, total: next?.total ?? x.total, items } : x)) },
      );
    } catch (e) {
      setData((d) => ({ ...d, error: apiErrorText(e) }));
    } finally {
      setExtending(null);
    }
  }

  const { groups, error } = data;
  return (
    <Panel
      title="Фото из каталога"
      action={
        <div className="flex items-center gap-1">
          {seed !== null && (
            <Button variant="ghost" size="sm" onClick={() => setSeed(null)}>
              Сначала новые
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>
            <Shuffle /> Другие фото
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Обработанные фото по вариантам знака, {seed === null ? "сначала новые" : "в случайном порядке"}. Берётся оригинал у поставщика,
        со знаком.{" "}
        <Link href="/admin/docs/watermark-history#labels" className="text-primary hover:underline">
          Что значат метки знака
        </Link>
      </p>
      <div className="relative mb-3">
        {pending ? (
          <LoaderCircle className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Номер фото, артикул или название товара" className="h-9 pl-9" />
      </div>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className={cn("max-h-96 space-y-3 overflow-y-auto pr-1 transition-opacity", pending && "opacity-50")}>
        {groups.length === 0 && !pending && <p className="text-sm text-muted-foreground">Ничего не нашлось.</p>}
        {groups.map((g) => (
          <div key={g.variant}>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>
                <span className="font-medium uppercase">{variantLabel(g.variant)}</span>
                <span className="tabular-nums">
                  {" "}
                  · {g.items.length} из {g.total.toLocaleString("ru-RU")}
                </span>
              </p>
              {g.items.length < g.total && (
                <button
                  onClick={() => more(g)}
                  disabled={extending !== null || pending}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
                >
                  {extending === g.variant && <LoaderCircle className="size-3 animate-spin" />}
                  ещё {Math.min(PAGE, g.total - g.items.length)}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {g.items.map((s) => (
                <button
                  key={s.image_id}
                  onClick={() => onPick(s)}
                  disabled={disabled}
                  title={`${s.name}\nАрт. ${s.sku}, фото ${s.image_id}`}
                  className={cn(
                    "size-16 overflow-hidden rounded-lg bg-muted p-1 ring-1 ring-foreground/10 transition hover:ring-primary disabled:opacity-50",
                    s.image_id === activeId && "ring-2 ring-primary",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimised thumbnail */}
                  <img src={s.thumb} alt={s.name} className="size-full object-contain mix-blend-multiply" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
