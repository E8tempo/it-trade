"use client";

import { ImageOff } from "lucide-react";
import Link from "next/link";

import { variantLabel } from "@/lib/admin/labels";
import type { LoadingPhoto } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const fmt = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

/** Processed photos to look through; each opens in the lab, with the original and the slider. */
export function PhotoGrid({ photos, threshold }: { photos: LoadingPhoto[]; threshold: number }) {
  if (photos.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Таких фото нет</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {photos.map((p) => (
        <li key={p.id}>
          <Link
            href={`/admin/lab/watermark?image=${p.id}`}
            target="_blank"
            title={`${p.name} — открыть в лаборатории`}
            className="group block overflow-hidden rounded-xl ring-1 ring-foreground/10 transition hover:ring-primary/50"
          >
            <div className="flex aspect-square items-center justify-center bg-muted/40">
              {p.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- processed photos are already sized WebP
                <img src={p.thumb} alt={p.name} loading="lazy" className="h-full w-full object-contain" />
              ) : (
                <ImageOff className="size-6 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-0.5 px-2 py-1.5 text-xs">
              <p className="truncate font-medium group-hover:text-primary">{p.name}</p>
              {p.error ? (
                <p className="line-clamp-2 text-destructive">{p.error}</p>
              ) : (
                <p className="flex justify-between gap-2 text-muted-foreground">
                  <span className="truncate">{p.wm_template ? variantLabel(p.wm_template) : "знак не найден"}</span>
                  {p.wm_left != null && (
                    <span className={cn("tabular-nums", p.wm_left > threshold && "font-medium text-destructive")} title="Осталось знака">
                      {fmt(p.wm_left)}
                    </span>
                  )}
                </p>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
