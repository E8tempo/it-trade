import { amountInWords, countLabel, formatAmount, formatNumber, formatShortDate } from "@/lib/format";
import type { Quote } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The offer as the client's customer gets it: the client's requisites and contacts, the lines at the client's
 * prices, the terms and the signature. Nothing of ours: no costs, no markups, no our article numbers or name.
 * Black on white, sized for an A4 sheet.
 */
export function QuoteDocument({ quote }: { quote: Quote }) {
  const { seller, totals } = quote;
  const p = seller.profile;
  const priced = quote.items.filter((i) => i.total != null);
  const photos = quote.show_photos && quote.items.some((i) => i.image);
  const contacts = [p.phone, p.email, p.website].filter(Boolean) as string[];
  const requisites = [
    `ИНН ${seller.inn}`,
    seller.kpp && `КПП ${seller.kpp}`,
    seller.ogrn && `${seller.inn.length === 12 ? "ОГРНИП" : "ОГРН"} ${seller.ogrn}`,
  ].filter(Boolean);
  const bank = p.bank_name || p.account || p.bik;
  const author = [seller.author_name, seller.author_phone, seller.author_email].filter(Boolean);

  return (
    <article className="quote-doc text-[12.5px] leading-snug text-black">
      <header className="flex items-start justify-between gap-8 border-b-2 border-black pb-4">
        <div className="min-w-0">
          <h1 className="text-[19px] leading-tight font-bold">{seller.name}</h1>
          <p className="mt-1.5 text-[11.5px] text-neutral-700">{requisites.join(" · ")}</p>
          {seller.address && <p className="text-[11.5px] text-neutral-700">{seller.address}</p>}
        </div>
        {contacts.length > 0 && (
          <ul className="shrink-0 text-right text-[11.5px]">
            {contacts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </header>

      <section className="mt-6">
        <h2 className="text-[17px] font-bold">
          Коммерческое предложение № {quote.number} от {formatShortDate(quote.created_at)}
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {quote.customer && (
            <>
              <dt className="text-neutral-600">Кому:</dt>
              <dd className="font-medium">
                {quote.customer}
                {quote.customer_contact && <span className="font-normal">, {quote.customer_contact}</span>}
              </dd>
            </>
          )}
          {!quote.customer && quote.customer_contact && (
            <>
              <dt className="text-neutral-600">Кому:</dt>
              <dd>{quote.customer_contact}</dd>
            </>
          )}
          {quote.title && (
            <>
              <dt className="text-neutral-600">Тема:</dt>
              <dd>{quote.title}</dd>
            </>
          )}
        </dl>
      </section>

      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left text-[11px] font-semibold">
            <th className="w-8 py-2 pr-2 text-center">№</th>
            {photos && <th className="w-16 py-2 pr-3" />}
            <th className="py-2 pr-3">Наименование</th>
            <th className="w-16 py-2 pr-3 text-right">Кол-во</th>
            <th className="w-24 py-2 pr-3 text-right">Цена, ₽</th>
            <th className="w-28 py-2 text-right">Сумма, ₽</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((i, n) => (
            <tr key={i.id} className="break-inside-avoid border-b border-neutral-300 align-top">
              <td className="py-2 pr-2 text-center tabular-nums">{n + 1}</td>
              {photos && (
                <td className="py-1.5 pr-3">
                  {i.image && (
                    // eslint-disable-next-line @next/next/no-img-element -- a ready thumbnail; printed as it is
                    <img src={i.image.urls.md} alt="" className="size-14 object-contain" />
                  )}
                </td>
              )}
              <td className="py-2 pr-3">
                <p className="font-medium">{i.name}</p>
                {i.sku != null && i.part && (
                  <p className="mt-0.5 text-[11px] text-neutral-600">
                    {i.vendor ? `${i.vendor}, ` : ""}арт. {i.part}
                  </p>
                )}
              </td>
              <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                {formatNumber(i.qty)} {i.unit}
              </td>
              <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">{i.sale_price != null ? formatAmount(i.sale_price) : "—"}</td>
              <td className="py-2 text-right whitespace-nowrap tabular-nums">{i.total != null ? formatAmount(i.total) : "по запросу"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-end break-inside-avoid">
        <dl className="grid grid-cols-[auto_8rem] gap-x-4 gap-y-1 text-right">
          <dt className="font-bold">Итого:</dt>
          <dd className="font-bold tabular-nums">{formatAmount(totals.total)}</dd>
          <dt>{totals.vat != null ? `В том числе НДС ${quote.vat_rate} %:` : "Без НДС"}</dt>
          <dd className="tabular-nums">{totals.vat != null ? formatAmount(totals.vat) : "—"}</dd>
        </dl>
      </div>
      <p className="mt-3 break-inside-avoid">
        Всего {countLabel(priced.length, ["наименование", "наименования", "наименований"])} на сумму {formatAmount(totals.total)} руб.
        <br />
        <span className="font-semibold">{amountInWords(totals.total)}</span>
      </p>

      {(quote.terms || quote.valid_until) && (
        <section className="mt-6 break-inside-avoid">
          <h3 className="font-bold">Условия</h3>
          {quote.terms && <p className="mt-1 whitespace-pre-line">{quote.terms}</p>}
          {quote.valid_until && <p className={cn(quote.terms && "mt-2")}>Предложение действительно до {formatShortDate(quote.valid_until)}.</p>}
        </section>
      )}

      {bank && (
        <section className="mt-6 break-inside-avoid text-[11.5px]">
          <h3 className="text-[12.5px] font-bold">Банковские реквизиты</h3>
          <p className="mt-1">
            {[p.bank_name, p.bik && `БИК ${p.bik}`].filter(Boolean).join(", ")}
            {p.account && (
              <>
                <br />
                Р/с {p.account}
              </>
            )}
            {p.corr_account && (
              <>
                <br />
                К/с {p.corr_account}
              </>
            )}
          </p>
        </section>
      )}

      <footer className="mt-8 break-inside-avoid">
        {author.length > 0 && <p className="text-[11.5px] text-neutral-700">Ответственный: {author.join(", ")}</p>}
        {(p.signer_title || p.signer_name) && (
          <div className="mt-8 flex items-end gap-4">
            <span>{p.signer_title}</span>
            <span className="mb-1 w-44 border-b border-black" />
            <span>{p.signer_name}</span>
          </div>
        )}
      </footer>
    </article>
  );
}
