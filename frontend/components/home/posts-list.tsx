import { ArrowRight, Megaphone, Newspaper, Pin } from "lucide-react";
import Link from "next/link";

import { formatDate } from "@/lib/format";
import type { Post } from "@/lib/types";
import { cn } from "@/lib/utils";

/** News and promotions as cards (the guest's landing and the client's home). */
export function PostsList({ posts, className }: { posts: Post[]; className?: string }) {
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {posts.map((p) => {
        const promo = p.kind === "promo";
        const paragraphs = p.body.split(/\n\s*\n/).filter((t) => t.trim());
        const external = p.link_url?.startsWith("http");
        return (
          <li key={p.id} className={cn("flex flex-col rounded-3xl border p-5", promo && "border-primary/25 bg-primary/[0.03]")}>
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {promo ? <Megaphone className="size-3.5 text-primary" /> : <Newspaper className="size-3.5" />}
              <span className={cn(promo && "text-primary")}>{promo ? "Акция" : "Новость"}</span>
              {p.published_at && <span>· {formatDate(p.published_at)}</span>}
              {p.pinned && <Pin className="ml-auto size-3.5" aria-label="Закреплено" />}
            </p>
            <h3 className="mt-2 text-base leading-snug font-semibold">{p.title}</h3>
            {paragraphs.length > 0 && (
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
                {paragraphs.map((t, i) => (
                  <p key={i} className="whitespace-pre-line">
                    {t}
                  </p>
                ))}
              </div>
            )}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
              {promo && p.ends_on ? <span className="text-xs text-muted-foreground">до {formatDate(p.ends_on)}</span> : <span />}
              {p.link_url &&
                (external ? (
                  <a href={p.link_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    Подробнее
                    <ArrowRight className="size-4" />
                  </a>
                ) : (
                  <Link href={p.link_url} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    Подробнее
                    <ArrowRight className="size-4" />
                  </Link>
                ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
