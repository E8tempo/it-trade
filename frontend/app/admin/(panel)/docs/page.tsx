import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/admin/ui";
import { DOCS } from "@/lib/admin/docs";

export const metadata: Metadata = { title: "Как это работает" };

export default function DocsIndexPage() {
  const groups = [...new Set(DOCS.map((d) => d.group))];
  return (
    <>
      <PageHeader
        title="Как это работает"
        description="Подробные объяснения алгоритмов магазина с формулами: что они делают, почему именно так и где их проверить в лаборатории."
      />
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g}>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase">{g}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {DOCS.filter((d) => d.group === g).map((d) => (
                <Link
                  key={d.slug}
                  href={`/admin/docs/${d.slug}`}
                  className="group flex flex-col rounded-2xl bg-background p-5 ring-1 ring-foreground/10 transition hover:ring-primary/40"
                >
                  <h3 className="font-semibold">{d.title}</h3>
                  <p className="mt-1.5 flex-1 text-sm text-muted-foreground">{d.description}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm text-primary">
                    Читать <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
