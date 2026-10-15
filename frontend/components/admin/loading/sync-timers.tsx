"use client";

import { LoaderCircle, PackageSearch, RefreshCw, type LucideIcon } from "lucide-react";
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

/** When the worker syncs prices and the catalog next, counting down. */
export function SyncTimers({ data }: { data: Loading }) {
  const now = useNow();
  const { schedule, sync, worker } = data;
  return (
    <div className="mt-5 grid grid-cols-1 gap-3 border-t pt-5 md:grid-cols-2">
      <Timer
        icon={RefreshCw}
        title="Цены и наличие"
        every={stockEveryLabel(sync.stock_every_min)}
        timer={schedule.stock}
        now={now}
        alive={worker.alive}
      />
      <Timer icon={PackageSearch} title="Каталог и категории" every={catalogEveryLabel(sync)} timer={schedule.catalog} now={now} alive={worker.alive} />
    </div>
  );
}

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
  const left = timer.next_at && now != null ? Date.parse(timer.next_at) / 1000 - now : null;
  let value: React.ReactNode;
  let tone = "";
  if (!alive) {
    value = "воркер не работает";
    tone = "text-muted-foreground text-base";
  } else if (timer.state === "running") {
    value = (
      <span className="inline-flex items-center gap-2">
        <LoaderCircle className="size-5 animate-spin" />
        идёт сейчас
      </span>
    );
    tone = "text-primary text-base";
  } else if (timer.state === "waiting") {
    value = "после первой загрузки";
    tone = "text-muted-foreground text-base";
  } else if (left == null) {
    value = "—";
  } else if (left < 1) {
    // the worker looks at its jobs every 30 seconds
    value = "вот-вот";
    tone = timer.state === "retry" ? "text-destructive" : "text-primary";
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
    <div className="flex items-center gap-4 rounded-xl bg-muted/40 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-background ring-1 ring-foreground/10">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">
          {every}
          {timer.last_success_at && ` · последнее ${when(timer.last_success_at)}`}
        </p>
      </div>
      <p className={cn("shrink-0 text-right text-xl font-semibold tabular-nums", tone)}>{value}</p>
    </div>
  );
}
