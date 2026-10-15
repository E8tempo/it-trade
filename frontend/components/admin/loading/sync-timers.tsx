"use client";

import { Check, PackageSearch, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { when } from "@/lib/admin/labels";
import type { Loading, SyncSettings, SyncTimer } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");
const hour = (h: number) => `${pad(h)}:00`;

/** "каждые 30 мин", "каждый час", "каждые 3 ч", "раз в сутки". */
export function stockEveryLabel(min: number): string {
  if (min % 1440 === 0) return "раз в сутки";
  if (min % 60) return `каждые ${min} мин`;
  return min === 60 ? "каждый час" : `каждые ${min / 60} ч`;
}

/** The catalog slots of a day: "раз в сутки в 05:00", "каждые 6 ч: 05:00, 11:00, 17:00, 23:00". */
export function catalogEveryLabel(c: Pick<SyncSettings, "catalog_every_hours" | "catalog_hour">): string {
  const n = c.catalog_every_hours;
  if (n === 24) return `раз в сутки в ${hour(c.catalog_hour)}`;
  const slots = Array.from({ length: 24 / n }, (_, k) => (c.catalog_hour % n) + k * n);
  return `каждые ${n} ч: ${slots.length <= 6 ? slots.map(hour).join(", ") : `с ${hour(slots[0])}`}`;
}

/** "09:18", "2:05:41", "1 д 3 ч". */
function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  if (h >= 24) return `${Math.floor(h / 24)} д ${h % 24} ч`;
  const rest = `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return h ? `${h}:${rest}` : rest;
}

// the browser's clock in whole seconds: re-renders the timers once a second, nothing on the server
const subscribe = (tick: () => void) => {
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
};
const useNow = () =>
  useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / 1000),
    () => null,
  );

/** When the worker syncs prices and the catalog next, counting down; a sync in progress shows a running bar,
 * a finished one turns green for a minute. */
export function SyncTimers({ data }: { data: Loading }) {
  const now = useNow();
  const { schedule, sync, worker } = data;
  return (
    <div className="mt-5 border-t pt-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Timer
          icon={RefreshCw}
          title="Цены и наличие"
          every={stockEveryLabel(sync.stock_every_min)}
          timer={schedule.stock}
          now={now}
          alive={worker.alive}
        />
        <Timer
          icon={PackageSearch}
          title="Каталог и категории"
          every={catalogEveryLabel(sync)}
          timer={schedule.catalog}
          now={now}
          alive={worker.alive}
        />
      </div>
      {worker.alive && worker.outdated && (
        <p className="mt-3 flex items-start gap-2 text-sm text-amber-700">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Воркер запущен до последнего изменения кода и может работать по старому расписанию. Перезапустите его.
        </p>
      )}
    </div>
  );
}

const JUST_DONE = 60; // seconds a finished sync stays green
const LATE = 90; // seconds past its time a due sync is called late (the worker looks every 30 s)

function Timer({
  icon: Icon,
  title,
  every,
  timer,
  now,
  alive,
}: {
  icon: LucideIcon;
  title: string;
  every: string;
  timer: SyncTimer;
  now: number | null;
  alive: boolean;
}) {
  const at = (iso: string | null) => (iso && now != null ? Date.parse(iso) / 1000 - now : null);
  const left = at(timer.next_at);
  const since = timer.last_success_at && now != null ? -at(timer.last_success_at)! : null;
  const running = alive && timer.state === "running";
  const justDone = alive && timer.state === "scheduled" && since != null && since < JUST_DONE;
  // a scheduled one whose countdown ran out before the next poll is due too
  const due = alive && (timer.state === "due" || ((timer.state === "scheduled" || timer.state === "retry") && left != null && left < 1));

  let value: React.ReactNode;
  let note: string | null = null;
  let tone = "";
  if (!alive) {
    value = "воркер не работает";
    tone = "text-base text-muted-foreground";
  } else if (running) {
    value = "обновляется…";
    tone = "text-base text-primary";
  } else if (justDone) {
    value = (
      <span className="inline-flex items-center gap-1.5">
        <Check className="size-5" />
        обновлено
      </span>
    );
    tone = "text-base text-emerald-700";
  } else if (due) {
    value = (
      <span className="inline-flex items-center gap-2">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
        </span>
        {timer.busy ? "в очереди" : "сейчас начнётся"}
      </span>
    );
    tone = "text-base text-primary";
    if (timer.busy) note = `после «${timer.busy}»`;
    else if (left != null && -left > LATE) note = "воркер пока не взял";
  } else if (timer.state === "waiting") {
    value = "после первой загрузки";
    tone = "text-base text-muted-foreground";
  } else if (left == null) {
    value = "—";
  } else {
    value = (
      <>
        <span className="mr-1.5 text-sm font-normal text-muted-foreground">{timer.state === "retry" ? "повтор через" : "через"}</span>
        {countdown(left)}
      </>
    );
    tone = timer.state === "retry" ? "text-destructive" : "";
  }

  return (
    <div
      className={cn(
        "relative flex items-center gap-4 overflow-hidden rounded-xl px-4 py-3 ring-1 transition-colors duration-500",
        running ? "bg-primary/5 ring-primary/25" : justDone ? "bg-emerald-500/5 ring-emerald-500/30" : "bg-muted/40 ring-transparent",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl bg-background ring-1 ring-foreground/10",
          running && "text-primary",
          justDone && "text-emerald-600",
        )}
      >
        <Icon className={cn("size-4", running ? "animate-spin [animation-duration:1.6s]" : !justDone && "text-muted-foreground")} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">
          {every}
          {timer.last_success_at && ` · последнее ${when(timer.last_success_at)}`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn("text-xl font-semibold tabular-nums", tone)}>{value}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {running && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/10" aria-hidden>
          <div className="h-full w-2/5 animate-indeterminate rounded-full bg-primary" />
        </div>
      )}
    </div>
  );
}
