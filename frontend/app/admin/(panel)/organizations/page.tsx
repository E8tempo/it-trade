import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Pager, SearchInput } from "@/components/admin/list-controls";
import { OrganizationsTable } from "@/components/admin/organizations/organizations-table";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { ORG_STATUSES } from "@/lib/admin/labels";
import type { OrganizationPage, OrganizationStatus } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Клиенты" };

type Props = PageProps<"/admin/organizations">;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function OrganizationsPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader
        title="Клиенты"
        description="Компании и ИП, зарегистрированные на сайте. Пока организацию не подтвердили, её сотрудники не видят цен и не могут заказывать. В карточке — проверка, сотрудники, договоры и заказы."
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <OrganizationsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function OrganizationsContent({ searchParams }: Pick<Props, "searchParams">) {
  const sp = await searchParams;
  const status = one(sp.status) as OrganizationStatus | undefined;
  const q = one(sp.q);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const query = new URLSearchParams({ page: String(page), per_page: "30" });
  if (status) query.set("status", status);
  if (q) query.set("q", q);
  const data = await apiServer<OrganizationPage>(`/api/admin/organizations?${query}`);
  const all = Object.values(data.counts).reduce((a, b) => a + (b ?? 0), 0);

  const tab = (value: OrganizationStatus | undefined, label: string, count: number) => {
    const params = new URLSearchParams();
    if (value) params.set("status", value);
    if (q) params.set("q", q);
    const active = status === value;
    return (
      <Link
        key={value ?? "all"}
        href={`/admin/organizations${params.size ? `?${params}` : ""}`}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
          active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {label}
        <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground/70")}>{count}</span>
      </Link>
    );
  };

  return (
    <Panel>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
          {tab(undefined, "Все", all)}
          {ORG_STATUSES.map((s) => tab(s.value, s.label, data.counts[s.value] ?? 0))}
        </div>
        <SearchInput placeholder="Название, ИНН или e-mail клиента" />
      </div>
      <OrganizationsTable organizations={data.items} />
      <Pager page={data.page} perPage={data.per_page} total={data.total} />
    </Panel>
  );
}
