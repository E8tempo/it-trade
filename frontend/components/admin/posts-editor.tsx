"use client";

import { LoaderCircle, Megaphone, Newspaper, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/admin/orders/order-fields";
import { Empty, Panel } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorText } from "@/lib/admin/errors";
import { day, when } from "@/lib/admin/labels";
import type { AdminPost, PostInput, PostKind } from "@/lib/admin/types";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const KINDS: Record<PostKind, string> = { news: "Новость", promo: "Акция" };

const EMPTY: PostInput = { kind: "news", title: "", body: "", link_url: null, is_published: false, pinned: false, ends_on: null };

/** News and promotions: drafts first, then the published ones; each is edited in place. */
export function PostsEditor({ posts }: { posts: AdminPost[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(body: PostInput, id: number | null) {
    setBusy(true);
    try {
      await api(id == null ? "/api/admin/posts" : `/api/admin/posts/${id}`, { method: id == null ? "POST" : "PUT", body: JSON.stringify(body) });
      toast.success(body.is_published ? "Запись сохранена и опубликована" : "Черновик сохранён");
      setEditing(null);
      router.refresh();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: AdminPost) {
    if (!window.confirm(`Удалить «${p.title}»?`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/posts/${p.id}`, { method: "DELETE" });
      toast.success("Запись удалена");
      router.refresh();
    } catch (e) {
      toast.error(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      action={
        editing !== "new" && (
          <Button onClick={() => setEditing("new")}>
            <Plus />
            Новая запись
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {editing === "new" && <PostForm initial={EMPTY} busy={busy} onSave={(b) => void save(b, null)} onCancel={() => setEditing(null)} />}
        {posts.map((p) =>
          editing === p.id ? (
            <PostForm key={p.id} initial={p} busy={busy} onSave={(b) => void save(b, p.id)} onCancel={() => setEditing(null)} />
          ) : (
            <article key={p.id} className={cn("flex gap-4 rounded-xl border p-4", !p.is_published && "border-dashed bg-muted/30")}>
              <span className="mt-0.5 shrink-0 text-muted-foreground">{p.kind === "promo" ? <Megaphone className="size-5 text-primary" /> : <Newspaper className="size-5" />}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{KINDS[p.kind]}</span>
                  {p.is_published ? <span>опубликована {when(p.published_at)}</span> : <span className="font-medium text-amber-700">черновик</span>}
                  {p.ends_on && <span>· до {day(p.ends_on)}</span>}
                  {p.pinned && (
                    <span className="inline-flex items-center gap-1">
                      · <Pin className="size-3" /> закреплена
                    </span>
                  )}
                </p>
                <h3 className="mt-1 font-semibold">{p.title}</h3>
                {p.body && <p className="mt-1 line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">{p.body}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon-sm" aria-label={`Изменить «${p.title}»`} disabled={busy || editing !== null} onClick={() => setEditing(p.id)}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Удалить «${p.title}»`} disabled={busy} onClick={() => void remove(p)}>
                  <Trash2 />
                </Button>
              </div>
            </article>
          ),
        )}
        {!posts.length && editing !== "new" && <Empty>Записей пока нет. Расскажите клиентам о новинках, акциях и изменениях в работе.</Empty>}
      </div>
    </Panel>
  );
}

function PostForm({ initial, busy, onSave, onCancel }: { initial: PostInput; busy: boolean; onSave: (p: PostInput) => void; onCancel: () => void }) {
  const [p, setP] = useState<PostInput>({
    kind: initial.kind,
    title: initial.title,
    body: initial.body,
    link_url: initial.link_url,
    is_published: initial.is_published,
    pinned: initial.pinned,
    ends_on: initial.ends_on,
  });
  const promo = p.kind === "promo";
  return (
    <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Тип">
          <Select items={KINDS} value={p.kind} onValueChange={(v) => v && setP({ ...p, kind: v as PostKind, ends_on: v === "promo" ? p.ends_on : null })}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(KINDS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Заголовок">
          <Input value={p.title} maxLength={255} onChange={(e) => setP({ ...p, title: e.target.value })} className="h-9" />
        </Field>
      </div>
      <Field label="Текст (абзацы — через пустую строку)">
        <Textarea rows={5} value={p.body} maxLength={20000} onChange={(e) => setP({ ...p, body: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ссылка «Подробнее» (необязательно)">
          <Input
            value={p.link_url ?? ""}
            maxLength={512}
            placeholder="/catalog/... или https://..."
            onChange={(e) => setP({ ...p, link_url: e.target.value || null })}
            className="h-9"
          />
        </Field>
        {promo && (
          <Field label="Последний день акции (необязательно)">
            <Input type="date" value={p.ends_on ?? ""} onChange={(e) => setP({ ...p, ends_on: e.target.value || null })} className="h-9" />
          </Field>
        )}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={p.is_published} onCheckedChange={(v) => setP({ ...p, is_published: v })} />
          Опубликовать
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={p.pinned} onCheckedChange={(v) => setP({ ...p, pinned: v })} />
          Закрепить первой
        </label>
      </div>
      <div className="flex gap-2">
        <Button disabled={busy || !p.title.trim()} onClick={() => onSave({ ...p, title: p.title.trim() })}>
          {busy && <LoaderCircle className="animate-spin" />}
          Сохранить
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
