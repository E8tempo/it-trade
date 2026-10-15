import Link from "next/link";

import { ORG_STATUS, STATUS } from "@/lib/admin/labels";
import type { OrderStatus, OrganizationStatus } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, action, className, children }: { title?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl bg-background p-5 ring-1 ring-foreground/10", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  const cls = "block rounded-2xl bg-background p-5 ring-1 ring-foreground/10";
  return href ? (
    <Link href={href} className={cn(cls, "transition hover:ring-foreground/25")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.tone, className)}>{s.label}</span>;
}

export function OrgStatusBadge({ status, className }: { status: OrganizationStatus; className?: string }) {
  const s = ORG_STATUS[status];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", s.tone, className)}>{s.label}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

/**
 * A card with a ruled header (title, a line of description, actions on the right), rows or any body, and an
 * optional footer under a rule — the account's style, used where a panel has several parts.
 */
export function Card({
  title,
  description,
  action,
  footer,
  className,
  bodyClassName,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl bg-background ring-1 ring-foreground/10", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </header>
      <div className={cn("px-5", bodyClassName)}>{children}</div>
      {footer && <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-muted/30 px-5 py-3 text-sm">{footer}</footer>}
    </section>
  );
}

/** A line of a Card: an icon in a tinted square, a title with details under it, and something on the right. */
export function CardLine({
  icon: Icon,
  tone = "bg-muted text-muted-foreground",
  spin,
  title,
  aside,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: string; // classes of the icon's square
  spin?: boolean;
  title: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 border-b py-4 last:border-0">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tone)}>
        <Icon className={cn("size-4", spin && "animate-spin [animation-duration:2.5s]")} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="min-w-0 text-sm font-medium">{title}</div>
          {aside && <div className="shrink-0 text-sm">{aside}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
