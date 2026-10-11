"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";

import { ProductImage } from "@/components/catalog/product-image";
import type { ProductImage as ProductImageT } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Thumbnails always fit their strip exactly, so none is cut at the edge:
 * - desktop: a column as tall as the main photo holding 6 thumbnails. Its width is
 *   (gallery width - 12px column gap - 5 x 8px thumbnail gaps) / 7, which makes
 *   6 thumbnails + 5 gaps equal to the main photo's height; more photos scroll by pages;
 * - phone: a row of 5 under the photo, scrolled with the finger.
 */
const DESKTOP_THUMBS = 6;
const GRID_WITH_THUMBS = "md:grid-cols-[calc((100%_-_52px)_/_7)_minmax(0,1fr)]";
const SWIPE_PX = 40;

export function Gallery({ images, name }: { images: ProductImageT[]; name: string }) {
  const [index, setIndex] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: images.length <= DESKTOP_THUMBS });
  const listRef = useRef<HTMLUListElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const count = images.length;
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  // keep the current thumbnail visible when the photo changes with the arrows, keys or a swipe
  useEffect(() => {
    const list = listRef.current;
    const item = list?.children[index] as HTMLElement | undefined;
    if (!list || !item) return;
    const row = getComputedStyle(list).flexDirection === "row";
    const [pos, size, view, scroll] = row
      ? [item.offsetLeft, item.offsetWidth, list.clientWidth, list.scrollLeft]
      : [item.offsetTop, item.offsetHeight, list.clientHeight, list.scrollTop];
    const target = pos < scroll ? pos : pos + size > scroll + view ? pos + size - view : scroll;
    if (target !== scroll) list.scrollTo({ [row ? "left" : "top"]: target, behavior: "smooth" });
  }, [index]);

  const onScroll = () => {
    const l = listRef.current;
    if (!l) return;
    const start = l.scrollTop <= 1;
    const end = l.scrollTop + l.clientHeight >= l.scrollHeight - 1;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  };

  // one page = all visible thumbnails but one, so the last of them stays in view
  const page = (dir: 1 | -1) => {
    const l = listRef.current;
    const first = l?.firstElementChild as HTMLElement | null;
    if (l && first) l.scrollBy({ top: dir * (l.clientHeight - first.offsetHeight), behavior: "smooth" });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (count < 2) return;
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  };

  const onTouchStart = (e: TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || count < 2) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className={cn("grid grid-cols-1 gap-3", count > 1 && GRID_WITH_THUMBS)}>
      <div
        className="group relative aspect-square touch-pan-y overflow-hidden rounded-3xl bg-muted/70 p-[8%] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        tabIndex={count > 1 ? 0 : undefined}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        aria-roledescription={count > 1 ? "галерея" : undefined}
        aria-label={count > 1 ? `Фото ${index + 1} из ${count}` : undefined}
      >
        <ProductImage
          key={images[index]?.id}
          image={images[index] ?? null}
          alt={name}
          sizes="(min-width: 1280px) 580px, (min-width: 768px) 46vw, 100vw"
          priority
          className="animate-in fade-in-0 duration-300"
        />
        {count > 1 && (
          <>
            <ArrowButton side="left" onClick={() => go(-1)} />
            <ArrowButton side="right" onClick={() => go(1)} />
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-background/85 px-2.5 py-1 text-xs tabular-nums shadow-sm md:hidden">
              {index + 1} / {count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="relative md:order-first">
          <ul
            ref={listRef}
            onScroll={onScroll}
            className="no-scrollbar relative flex snap-x snap-mandatory gap-2 overflow-x-auto md:absolute md:inset-0 md:snap-y md:flex-col md:overflow-x-hidden md:overflow-y-auto"
          >
            {images.map((img, i) => (
              <li key={img.id} className="w-[calc((100%_-_32px)_/_5)] shrink-0 snap-start md:w-full">
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Фото ${i + 1}`}
                  aria-current={i === index}
                  className={cn(
                    "block aspect-square w-full overflow-hidden rounded-xl bg-muted/70 p-1.5 ring-2 ring-inset transition",
                    i === index ? "ring-primary" : "ring-transparent hover:ring-border",
                  )}
                >
                  <ProductImage image={img} alt="" sizes="(min-width: 768px) 96px, 20vw" />
                </button>
              </li>
            ))}
          </ul>
          {!edges.start && <PageButton dir={-1} onClick={() => page(-1)} />}
          {!edges.end && <PageButton dir={1} onClick={() => page(1)} />}
        </div>
      )}
    </div>
  );
}

function ArrowButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Предыдущее фото" : "Следующее фото"}
      className={cn(
        "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/90 shadow-md transition hover:bg-background md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

/** Scrolls the desktop thumbnail column by a page; the phone row is scrolled with the finger. */
function PageButton({ dir, onClick }: { dir: 1 | -1; onClick: () => void }) {
  const Icon = dir < 0 ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir < 0 ? "Предыдущие фото" : "Следующие фото"}
      className={cn(
        "absolute left-1/2 z-10 grid size-7 -translate-x-1/2 place-items-center rounded-full bg-background/95 shadow-md ring-1 ring-border transition hover:bg-background max-md:hidden",
        dir < 0 ? "top-1.5" : "bottom-1.5",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
