import Link from "next/link";
import { cn } from "@/lib/utils";

import { CardCartButton } from "@/components/catalog/card-cart-button";
import { CardPrice } from "@/components/catalog/card-price";
import { ProductImage } from "@/components/catalog/product-image";
import type { ProductCard as ProductCardT } from "@/lib/types";
import { productHref } from "@/lib/urls";

export function ProductCard({
  product,
  sizes,
  priority,
}: {
  product: ProductCardT;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <div className="group relative h-full">
      <Link
        href={productHref(product)}
        className="flex h-full flex-col gap-3 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-muted/70 p-[9%] transition-colors duration-300 group-hover:bg-muted">
          <ProductImage
            image={product.image}
            alt={product.name}
            sizes={sizes}
            priority={priority}
            className={cn("transition-transform duration-500 ease-out group-hover:scale-[1.04]", !product.in_stock && "opacity-50 grayscale")}
          />
          {!product.in_stock && (
            <span className="absolute top-3 left-3 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Нет в наличии
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 px-0.5">
          <CardPrice sku={product.sku} className="text-[17px] font-semibold tracking-tight tabular-nums" />
          <h3 className="line-clamp-2 text-sm leading-snug text-foreground/85 group-hover:text-foreground">{product.name}</h3>
          {product.vendor && <span className="mt-auto pt-0.5 text-xs text-muted-foreground">{product.vendor}</span>}
        </div>
      </Link>
      {product.in_stock && (
        // a sibling over the photo's corner, not inside the link: a button within a link is invalid
        // HTML, and clicking it would also follow the link
        <div className="pointer-events-none absolute inset-x-0 top-0 aspect-square">
          <CardCartButton sku={product.sku} name={product.name} className="pointer-events-auto absolute right-2 bottom-2 sm:right-2.5 sm:bottom-2.5" />
        </div>
      )}
    </div>
  );
}

const GRID = {
  // full-width pages (home, similar products)
  wide: {
    list: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
    sizes: "(min-width: 1280px) 230px, (min-width: 1024px) 23vw, (min-width: 640px) 31vw, 46vw",
  },
  // next to the filters sidebar
  narrow: {
    list: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4",
    sizes: "(min-width: 1280px) 230px, (min-width: 1024px) 24vw, (min-width: 640px) 31vw, 46vw",
  },
};

export function ProductGrid({
  products,
  layout = "wide",
  priorityCount = 0,
  className,
}: {
  products: ProductCardT[];
  layout?: keyof typeof GRID;
  priorityCount?: number;
  className?: string;
}) {
  const g = GRID[layout];
  return (
    <ul className={cn("grid gap-x-3 gap-y-8 sm:gap-x-5", g.list, className)}>
      {products.map((p, i) => (
        <li key={p.sku}>
          <ProductCard product={p} sizes={g.sizes} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
