import { Package, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Breadcrumbs } from "@/components/catalog/breadcrumbs";
import { ProductGridSkeleton } from "@/components/catalog/listing";
import { ProductGrid } from "@/components/catalog/product-card";
import { AddToCart } from "@/components/product/add-to-cart";
import { ProductPrice } from "@/components/product/product-price";
import { Gallery } from "@/components/product/gallery";
import { Skeleton } from "@/components/ui/skeleton";
import { getProduct, getProducts } from "@/lib/catalog";
import { cleanDescription, formatNumber, pluralize } from "@/lib/format";
import type { ProductDetail } from "@/lib/types";
import { categoryHref, idFromSlug, productHref } from "@/lib/urls";

type Props = PageProps<"/p/[slug]">;

async function loadProduct(params: Props["params"]): Promise<ProductDetail> {
  const sku = idFromSlug((await params).slug);
  const product = sku ? await getProduct(sku) : null;
  if (!product) notFound();
  return product;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const sku = idFromSlug((await params).slug);
  const product = sku ? await getProduct(sku) : null;
  if (!product) return { title: "Товар не найден" };
  const image = product.images[0]?.urls.lg;
  return {
    title: product.name,
    description: [product.name, product.vendor, product.in_stock && "в наличии, оптом для бизнеса"]
      .filter(Boolean)
      .join(" — "),
    alternates: { canonical: productHref(product) },
    openGraph: image ? { images: [image] } : undefined,
  };
}

export default function ProductPage({ params }: Props) {
  return (
    <div className="container-shop pt-5 sm:pt-8">
      <Suspense fallback={<ProductSkeleton />}>
        <ProductView params={params} />
      </Suspense>
    </div>
  );
}

async function ProductView({ params }: Pick<Props, "params">) {
  const p = await loadProduct(params);
  // the trail ends at the category: the product name is the page heading
  const crumbs = [{ name: "Главная", href: "/" }, ...p.breadcrumbs.map((c) => ({ name: c.name, href: categoryHref(c) }))];
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <div className="mt-5 grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
        <Gallery images={p.images} name={p.name} />
        <div className="md:sticky md:top-28 md:self-start">
          <ProductSummary product={p} />
        </div>
      </div>
      <ProductDetails product={p} />
      {p.category && (
        <Suspense fallback={<SimilarSkeleton />}>
          <SimilarProducts categoryId={p.category.id} categoryHref={categoryHref(p.category)} exclude={p.sku} />
        </Suspense>
      )}
    </>
  );
}

function ProductSummary({ product: p }: { product: ProductDetail }) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {p.vendor && (
          <Link
            href={`/search?vendor=${encodeURIComponent(p.vendor)}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            {p.vendor}
          </Link>
        )}
        <h1 className="text-xl leading-snug font-semibold tracking-tight sm:text-2xl">{p.name}</h1>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            Артикул <span className="font-mono text-foreground/80">{p.sku}</span>
          </span>
          {p.part && (
            <span>
              Код производителя <span className="font-mono text-foreground/80">{p.part}</span>
            </span>
          )}
        </p>
      </div>

      <div className="space-y-5 rounded-3xl border p-5 sm:p-6">
        <div className="space-y-2">
          <ProductPrice sku={p.sku} path={productHref(p)} />
          <StockStatus inStock={p.in_stock} />
        </div>
        {p.in_stock && <AddToCart sku={p.sku} name={p.name} multiplicity={p.multiplicity} />}
        {(!!p.warranty_months || p.multiplicity > 1) && (
          <ul className="space-y-2.5 border-t pt-4 text-sm">
            {!!p.warranty_months && (
              <li className="flex items-center gap-2.5">
                <ShieldCheck className="size-4 text-muted-foreground" />
                Гарантия {p.warranty_months} {pluralize(p.warranty_months, ["месяц", "месяца", "месяцев"])}
              </li>
            )}
            {p.multiplicity > 1 && (
              <li className="flex items-center gap-2.5">
                <Package className="size-4 text-muted-foreground" />
                Продаётся упаковками по {p.multiplicity} шт.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function StockStatus({ inStock }: { inStock: boolean }) {
  return inStock ? (
    <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
      <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20" />В наличии
    </p>
  ) : (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="size-2 rounded-full bg-muted-foreground/40" />
      Нет в наличии
    </p>
  );
}

function formatDecimal(value: number, digits = 2): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
}

function ProductDetails({ product: p }: { product: ProductDetail }) {
  const description = cleanDescription(p.description);
  const specs: [string, string][] = [
    ["Бренд", p.vendor],
    ["Код производителя", p.part],
    ["Артикул", String(p.sku)],
    ["Гарантия", p.warranty_months ? `${p.warranty_months} ${pluralize(p.warranty_months, ["месяц", "месяца", "месяцев"])}` : null],
    ["Вес в упаковке", p.weight ? `${formatDecimal(p.weight)} кг` : null],
    ["Объём упаковки", p.volume ? `${formatDecimal(p.volume * 1000)} л` : null],
    ["Штрихкод", p.barcodes.length ? p.barcodes.slice(0, 3).join(", ") : null],
    ["Кратность заказа", p.multiplicity > 1 ? `${formatNumber(p.multiplicity)} шт.` : null],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <section className="mt-14 grid grid-cols-1 gap-10 border-t pt-10 lg:grid-cols-2 lg:gap-16">
      <div>
        <h2 className="mb-5 text-xl font-semibold tracking-tight">Характеристики</h2>
        <dl className="divide-y text-sm">
          {specs.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 py-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {description && (
        <div>
          <h2 className="mb-5 text-xl font-semibold tracking-tight">Описание</h2>
          <p className="text-[15px] leading-relaxed whitespace-pre-line text-foreground/85">{description}</p>
        </div>
      )}
    </section>
  );
}

async function SimilarProducts({ categoryId, categoryHref, exclude }: { categoryId: number; categoryHref: string; exclude: number }) {
  const page = await getProducts(
    { category: categoryId, vendors: [], sort: "popular", page: 1 },
    { perPage: 10, withImage: true, exclude, facets: false },
  );
  if (!page.items.length) return null;
  return (
    <section className="mt-16">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Похожие товары</h2>
        <Link href={categoryHref} className="text-sm font-medium text-primary hover:underline">
          Все в категории
        </Link>
      </div>
      <ProductGrid products={page.items} />
    </section>
  );
}

function SimilarSkeleton() {
  return (
    <div className="mt-16 space-y-6">
      <Skeleton className="h-6 w-48" />
      <ProductGridSkeleton count={5} layout="wide" />
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="h-4 w-72" />
      <div className="mt-5 grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[calc((100%_-_52px)_/_7)_minmax(0,1fr)]">
          <Skeleton className="aspect-square rounded-3xl" />
          <div className="hidden flex-col gap-2 md:order-first md:flex">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
          <Skeleton className="h-60 rounded-3xl" />
        </div>
      </div>
    </div>
  );
}
