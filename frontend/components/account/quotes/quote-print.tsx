"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { quoteName } from "@/components/account/quotes/labels";
import { QuoteDocument } from "@/components/account/quotes/quote-document";
import { useAccountData } from "@/components/account/use-account-data";
import { errorMessage, hasStatus } from "@/components/shop/errors";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Quote } from "@/lib/types";
import { cn } from "@/lib/utils";

// the sheet's margins on paper (on screen the sheet has them as padding); the page is as tall as the
// document, else the full-height layout spills an empty sheet
const PAGE_CSS = "@page { size: A4; margin: 14mm 12mm 14mm 14mm; } @media print { html, body { height: auto; min-height: 0; } }";

/** An offer on an A4 sheet, with a bar to print it or save it as PDF (the browser's print dialog). */
export function QuotePrint({ id }: { id: string }) {
  const valid = /^\d{1,10}$/.test(id);
  const { data: quote, error, reload } = useAccountData<Quote>(`/api/quotes/${valid ? id : "0"}`);

  // the name the browser suggests for the PDF
  useEffect(() => {
    if (quote) document.title = [quoteName(quote.number), quote.customer].filter(Boolean).join(" — ");
  }, [quote]);

  return (
    <>
      <style>{PAGE_CSS}</style>
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-md print:hidden">
        <div className="mx-auto flex max-w-[210mm] items-center justify-between gap-3 px-4 py-3">
          <Link href={valid ? `/account/quotes/${id}` : "/account/quotes"} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            К редактированию
          </Link>
          <Button className="h-10 gap-2 rounded-xl px-4" disabled={!quote} onClick={() => window.print()}>
            <Printer />
            Печать или PDF
          </Button>
        </div>
      </div>
      <div className="px-4 py-6 sm:py-10 print:p-0">
        <div className="mx-auto max-w-[210mm] bg-white p-[10mm] shadow-sm ring-1 ring-black/5 sm:p-[14mm] print:max-w-none print:p-0 print:shadow-none print:ring-0">
          {!valid || hasStatus(error, 404, 422) ? (
            <Message title="КП не найдено" text="Возможно, его удалили или оно сделано от организации, где вы больше не работаете." />
          ) : error ? (
            <Message title={errorMessage(error, "Не удалось загрузить КП.")} text="Проверьте подключение к интернету и попробуйте ещё раз." onRetry={reload} />
          ) : quote ? (
            <QuoteDocument quote={quote} />
          ) : (
            <div className="space-y-4" aria-hidden>
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-64 w-full" />
            </div>
          )}
        </div>
        <p className="mx-auto mt-4 max-w-[210mm] text-center text-xs text-muted-foreground print:hidden">
          Чтобы получить PDF, в окне печати выберите «Сохранить как PDF». Колонтитулы браузера (адрес, дата) отключаются там же.
        </p>
      </div>
    </>
  );
}

function Message({ title, text, onRetry }: { title: string; text: string; onRetry?: () => void }) {
  return (
    <div className="py-16 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{text}</p>
      {onRetry ? (
        <Button variant="outline" className="mt-5 h-10 rounded-xl px-4" onClick={onRetry}>
          Повторить
        </Button>
      ) : (
        <Link href="/account/quotes" className={cn(buttonVariants({ variant: "outline" }), "mt-5 h-10 rounded-xl px-4")}>
          Все КП
        </Link>
      )}
    </div>
  );
}
