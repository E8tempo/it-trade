import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DOC_CONTENT } from "@/components/admin/docs/content";
import { Skeleton } from "@/components/ui/skeleton";
import { DOCS, docBySlug } from "@/lib/admin/docs";
import { cn } from "@/lib/utils";

type Props = PageProps<"/admin/docs/[slug]">;

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = docBySlug((await params).slug);
  return { title: doc ? doc.title : "Статья не найдена" };
}

export default function DocPage({ params }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem] max-w-3xl rounded-2xl" />}>
      <Doc params={params} />
    </Suspense>
  );
}

async function Doc({ params }: Pick<Props, "params">) {
  const { slug } = await params;
  const doc = docBySlug(slug);
  const Content = DOC_CONTENT[slug];
  if (!doc || !Content) notFound();
  const i = DOCS.indexOf(doc);
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];

  return (
    <div className="flex gap-10">
      <div className="min-w-0 flex-1">
        <Link href="/admin/docs" className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Как это работает
        </Link>
        <p className="text-sm font-medium text-primary">{doc.group}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">{doc.description}</p>
        <div className="mt-6 rounded-2xl bg-background px-5 py-2 ring-1 ring-foreground/10 sm:px-8">
          <Content />
        </div>
        <nav className="mt-6 flex max-w-3xl justify-between gap-4 text-sm" aria-label="Соседние статьи">
          {prev ? (
            <Link href={`/admin/docs/${prev.slug}`} className="hover:underline">
              ← {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/admin/docs/${next.slug}`} className="text-right hover:underline">
              {next.title} →
            </Link>
          )}
        </nav>
      </div>
      <aside className="sticky top-20 hidden h-fit w-56 shrink-0 2xl:block">
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">Все статьи</p>
        <ul className="space-y-0.5 text-sm">
          {DOCS.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/admin/docs/${d.slug}`}
                className={cn(
                  "block rounded-lg px-2.5 py-1.5",
                  d.slug === slug ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {d.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
