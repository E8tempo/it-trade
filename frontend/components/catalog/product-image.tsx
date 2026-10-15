"use client";

import { Package } from "lucide-react";
import { useState } from "react";

import type { ProductImage as ProductImageT } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  image: ProductImageT | null;
  alt: string;
  /** `sizes` attribute for the srcset (md 480 / lg 1000 px); small slots (cart, search) get md */
  sizes: string;
  priority?: boolean;
  className?: string;
};

type Status = "initial" | "loading" | "loaded" | "error";

/**
 * Product photo. Files are already resized WebP served from /media (see the backend image
 * pipeline), so a plain <img> with a srcset is used instead of next/image optimisation.
 * `mix-blend-multiply` blends the white studio backgrounds into the tile colour.
 *
 * Until the file arrives a pulsing placeholder is shown (a photo that is processed on demand
 * takes a second or two); images that are already loaded at hydration are shown as is.
 */
export function ProductImage({ image, alt, sizes, priority, className }: Props) {
  const [status, setStatus] = useState<Status>("initial");

  if (!image || status === "error") {
    return (
      <div className={cn("grid size-full place-items-center text-muted-foreground/35", className)} aria-hidden>
        <Package className="size-1/4" strokeWidth={1.25} />
      </div>
    );
  }

  const { md, lg } = image.urls;
  return (
    <div className="relative size-full">
      {status === "loading" && <div className="absolute inset-0 animate-pulse rounded-xl bg-foreground/[0.04]" aria-hidden />}
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimised images, see above */}
      <img
        ref={(el) => {
          // the image may have finished (or failed) before hydration, when onLoad was not attached yet
          if (el && status === "initial") setStatus(!el.complete ? "loading" : el.naturalWidth > 0 ? "loaded" : "error");
        }}
        src={md}
        srcSet={`${md} 480w, ${lg} 1000w`}
        sizes={sizes}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={cn(
          "size-full object-contain mix-blend-multiply transition-opacity duration-300",
          status === "loading" && "opacity-0",
          className,
        )}
      />
    </div>
  );
}
