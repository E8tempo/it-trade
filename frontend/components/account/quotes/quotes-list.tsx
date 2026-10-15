"use client";

import { Building2, ChevronRight, FileText, LoaderCircle, Plus, Settings2, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AccountSkeleton, PageHeading } from "@/components/account/account-shell";
import { LoadError } from "@/components/account/orders-view";
import { quoteName } from "@/components/account/quotes/labels";
import { ProfileDialog } from "@/components/account/quotes/profile-dialog";
import { errorMessage } from "@/components/shop/errors";
import { useCart, useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { countLabel, formatDate, formatMoney } from "@/lib/format";
import type { Quote, QuoteListItem, QuotePage } from "@/lib/types";

const PER_PAGE = 20;

/** Makes a new offer (from the cart, when asked) for the organization the user works for and opens it. */
export function useNewQuote() {
  const router = useRouter();
  const { keepSession } = useSession();
  const { payment } = useCart();
  const [busy, setBusy] = useState<"empty" | "cart" | null>(null);
  const create = (fromCart: boolean) => {
    setBusy(fromCart ? "cart" : "empty");
    keepSession()
      .then(() => api<Quote>("/api/quotes", { method: "POST", body: JSON.stringify({ from_cart: fromCart, payment }) }))
      .then(
        (q) => router.push(`/account/quotes/${q.id}`),
        (e: unknown) => {
          toast.error(errorMessage(e, "Не удалось создать КП"));
          setBusy(null);
        },
      );
  };
  return { busy, create };
}

/** The offers the client made for their customers, the last changed first. */
export function QuotesList() {
  const { keepSession, access } = useSession();
  const { cart } = useCart();
  const { busy, create } = useNewQuote();
  const [result, setResult] = useState<{ page: QuotePage; items: QuoteListItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [profile, setProfile] = useState(false);

  const fetchPage = useCallback(
    (page: number) => keepSession().then(() => api<QuotePage>(`/api/quotes?page=${page}&per_page=${PER_PAGE}`)),
    [keepSession],
  );

  useEffect(() => {
    let alive = true;
    fetchPage(1).then(
      (page) => alive && setResult({ page, items: page.items }),
      (e: unknown) => alive && setError(errorMessage(e, "Не удалось загрузить КП.")),
    );
    return () => {
      alive = false;
    };
  }, [fetchPage, attempt]);

  if (access === "pending") {
    return (
      <div className="max-w-4xl">
        <PageHeading title="КП для клиентов" />
        <p className="rounded-3xl bg-muted/50 px-5 py-10 text-center text-sm text-muted-foreground">
          КП откроются, когда менеджер подтвердит вашу организацию: в них нужны цены.
        </p>
      </div>
    );
  }
  if (error && !result) {
    return (
      <LoadError
        message={error}
        onRetry={() => {
          setError(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  if (!result) return <AccountSkeleton />;

  const cartLines = cart?.items.length ?? 0;
  const more = result.items.length < result.page.total;
  return (
    <div className="max-w-4xl">
      <PageHeading
        title="КП для клиентов"
        lead="Коммерческие предложения вашим заказчикам: наши товары с вашей наценкой, ваши реквизиты и контакты. Наших цен и названия в КП нет."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10 gap-2 rounded-xl px-3.5" onClick={() => setProfile(true)}>
              <Settings2 />
              Реквизиты для КП
            </Button>
            {cartLines > 0 && (
              <Button variant="outline" className="h-10 gap-2 rounded-xl px-3.5" disabled={busy !== null} onClick={() => create(true)}>
                {busy === "cart" ? <LoaderCircle className="animate-spin" /> : <ShoppingCart />}
                Из корзины
              </Button>
            )}
            <Button className="h-10 gap-2 rounded-xl px-4" disabled={busy !== null} onClick={() => create(false)}>
              {busy === "empty" ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Новое КП
            </Button>
          </div>
        }
      />
      {result.items.length ? (
        <>
          <ul className="space-y-2">
            {result.items.map((q) => (
              <li key={q.id}>
                <QuoteRow quote={q} />
              </li>
            ))}
          </ul>
          {more && (
            <Button
              variant="outline"
              className="mt-5 h-10 w-full gap-2 rounded-xl sm:w-auto sm:px-5"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                fetchPage(Math.floor(result.items.length / PER_PAGE) + 1)
                  .then((page) => setResult((r) => r && { page, items: [...r.items, ...page.items.filter((q) => !r.items.some((p) => p.id === q.id))] }))
                  .catch((e: unknown) => toast.error(errorMessage(e, "Не удалось загрузить КП.")))
                  .finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore && <LoaderCircle className="animate-spin" />}
              Показать ещё
            </Button>
          )}
        </>
      ) : (
        <NoQuotes />
      )}
      <ProfileDialog open={profile} onOpenChange={setProfile} />
    </div>
  );
}

function QuoteRow({ quote: q }: { quote: QuoteListItem }) {
  return (
    <Link
      href={`/account/quotes/${q.id}`}
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-2xl border p-4 transition-colors outline-none hover:border-foreground/25 focus-visible:ring-3 focus-visible:ring-ring/50 sm:grid-cols-[7rem_minmax(0,1fr)_auto_auto]"
    >
      <div>
        <p className="font-semibold tabular-nums">{quoteName(q.number)}</p>
        <p className="text-xs text-muted-foreground">{formatDate(q.created_at)}</p>
      </div>
      <div className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1">
        <p className="truncate text-sm font-medium">{q.customer || <span className="font-normal text-muted-foreground">Заказчик не указан</span>}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {q.title ? (
            <span className="truncate">{q.title}</span>
          ) : (
            <>
              <Building2 className="size-3.5 shrink-0" />
              <span className="truncate">{q.organization_name}</span>
            </>
          )}
          {q.author_name && <span className="truncate"> · {q.author_name}</span>}
        </p>
      </div>
      <div className="row-span-2 text-right sm:row-span-1">
        <p className="font-semibold tracking-tight tabular-nums">{formatMoney(q.total)}</p>
        <p className="text-xs text-muted-foreground">{countLabel(q.lines, ["строка", "строки", "строк"])}</p>
      </div>
      <ChevronRight className="hidden size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
    </Link>
  );
}

function NoQuotes() {
  return (
    <div className="flex flex-col items-center rounded-3xl bg-muted/50 px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-background shadow-xs">
        <FileText className="size-6 text-muted-foreground" />
      </span>
      <p className="mt-5 text-lg font-semibold">КП пока нет</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Соберите товары в корзину и нажмите «Из корзины» или начните новое КП и добавьте товары поиском. Наценку, НДС и округление задаёте вы; в КП
        печатаются ваши реквизиты.
      </p>
    </div>
  );
}
