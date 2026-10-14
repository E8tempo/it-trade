import type { Metadata } from "next";
import { Suspense } from "react";

import { PostsEditor } from "@/components/admin/posts-editor";
import { PageHeader } from "@/components/admin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminPost } from "@/lib/admin/types";
import { apiServer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Новости и акции" };

export default function PostsPage() {
  return (
    <>
      <PageHeader
        title="Новости и акции"
        description="Опубликованные записи видны на главной: клиентам — в их кабинете, гостям — на странице для бизнеса (там с задержкой до 5 минут). Акция скрывается сама после последнего дня."
      />
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <PostsContent />
      </Suspense>
    </>
  );
}

async function PostsContent() {
  return <PostsEditor posts={await apiServer<AdminPost[]>("/api/admin/posts")} />;
}
