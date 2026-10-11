import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

export type Crumb = { name: string; href?: string };

/** Full trail from sm up; on phones only a link back to the parent. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const parent = items.findLast((c) => c.href);
  return (
    <nav aria-label="Навигация" className="text-sm text-muted-foreground">
      {parent?.href && (
        <Link href={parent.href} className="inline-flex items-center gap-1 hover:text-foreground sm:hidden">
          <ChevronLeft className="size-4" />
          {parent.name}
        </Link>
      )}
      <ol className="hidden flex-wrap items-center gap-x-1.5 gap-y-1 sm:flex">
        {items.map((c, i) => (
          <Fragment key={`${i}-${c.name}`}>
            {i > 0 && (
              <li role="presentation" aria-hidden className="text-muted-foreground/50">
                <ChevronRight className="size-3.5" />
              </li>
            )}
            <li>
              {c.href ? (
                <Link href={c.href} className="transition-colors hover:text-foreground">
                  {c.name}
                </Link>
              ) : (
                <span aria-current="page" className="text-foreground">
                  {c.name}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
