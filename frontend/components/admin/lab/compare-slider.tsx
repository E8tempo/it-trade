"use client";

import { useState } from "react";

/** Before/after of the same picture: drag the handle to move the border between them. */
export function CompareSlider({ before, after, alt }: { before: string; after: string; alt: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="relative select-none overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the lab */}
      <img src={after} alt={`${alt}: после`} className="block h-auto w-full" draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the lab */}
      <img
        src={before}
        alt={`${alt}: до`}
        className="absolute inset-0 block h-auto w-full"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.2)]" style={{ left: `${pos}%` }}>
        <span className="absolute top-1/2 left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-medium shadow-md">
          ⇆
        </span>
      </div>
      <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-xs text-white">до</span>
      <span className="pointer-events-none absolute top-2 right-2 rounded-md bg-black/55 px-1.5 py-0.5 text-xs text-white">после</span>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        aria-label="Граница до/после"
      />
    </div>
  );
}
