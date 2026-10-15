import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SupplierPricingEditor } from "@/components/admin/pricing/supplier-pricing-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { isPriceType, PRICE_TYPES, supplierName } from "@/lib/admin/suppliers";
import type { AdminCategory, AdminSupplier, PricePreview, PriceType, SupplierPricing } from "@/lib/admin/types";
import { ApiError, apiServer } from "@/lib/api/server";
import { countLabel, formatNumber } from "@/lib/format";

type Props = PageProps<"/admin/suppliers/[code]">;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// the summary's sample purchase
const EXAMPLE_SUPPLIER_PRICE = 10_000;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `Цены · ${supplierName(code) ?? "Поставщик"}` };
}

export default function SupplierPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<SupplierSkeleton />}>
      <SupplierContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function loadPricing(code: string): Promise<SupplierPricing | null> {
  try {
    return await apiServer<SupplierPricing>(`/api/admin/suppliers/${encodeURIComponent(code)}/pricing`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** The sample purchase priced by the saved rules of every type; the summary shows dashes without it. */
async function loadExample(code: string): Promise<Record<PriceType, number> | null> {
  try {
    const preview = await apiServer<PricePreview>("/api/admin/pricing/preview", {
      method: "POST",
      body: JSON.stringify({ supplier: code, supplier_price: EXAMPLE_SUPPLIER_PRICE }),
    });
    return preview.by_type ?? null;
  } catch {
    return null;
  }
}

async function SupplierContent({ params, searchParams }: Props) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const [suppliers, pricing, categories, example] = await Promise.all([
    apiServer<AdminSupplier[]>("/api/admin/suppliers"),
    loadPricing(code),
    apiServer<AdminCategory[]>("/api/admin/categories"),
    loadExample(code),
  ]);
  const supplier = suppliers.find((s) => s.code === code);
  if (!supplier || !pricing) notFound();
  const type = one(sp.type);

  return (
    <>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        В каталоге {countLabel(supplier.products)}, в наличии {formatNumber(supplier.in_stock)}. Цены на сайте считаются из закупочных
        цен поставщика. Сайт продаёт оптом: у товара две цены — за наличные и по безналу, — и у каждой свои правила. Пересчёт идёт
        сразу после сохранения и при каждом обновлении остатков. Подробно — в разделе{" "}
        <Link href="/admin/docs/pricing" className="text-primary hover:underline">
          «Как считается цена»
        </Link>
        .
      </p>
      <SupplierPricingEditor
        supplier={supplier.code}
        pricing={pricing}
        categories={categories}
        example={{ supplierPrice: EXAMPLE_SUPPLIER_PRICE, prices: example }}
        initialType={isPriceType(type) ? type : PRICE_TYPES[0].value}
      />
    </>
  );
}

function SupplierSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-full max-w-3xl" />
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-8 w-full max-w-xl" />
      <Skeleton className="h-[36rem] rounded-2xl" />
    </div>
  );
}
