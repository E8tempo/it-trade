import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// The account's building blocks, so every section looks the same: rounded cards with a ruled header and lines
// of «icon · label · value · action».

/** Classes for <Card>: roomier than the admin panel's. */
export const ACCOUNT_CARD = "gap-0 rounded-3xl py-0 [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]";
/** Classes for <CardHeader> with a rule under it. */
export const CARD_HEAD = "border-b py-(--card-spacing)";
/** Classes for <CardFooter>: actions under a rule. */
export const CARD_FOOT = "flex flex-wrap items-center gap-2 border-t bg-muted/30 py-4";

/** A line of a card: an icon, a label with its value, and an action on the right. */
export function CardRow({ icon: Icon, label, children, action }: { icon: LucideIcon; label: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b py-4 last:border-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium break-words">{children}</div>
      </div>
      {action}
    </div>
  );
}

/** A small rounded label: a status, a role. */
export function Pill({ tone, children, className }: { tone?: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium", tone ?? "bg-muted text-muted-foreground", className)}>
      {children}
    </span>
  );
}
