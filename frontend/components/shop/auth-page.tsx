import { BadgePercent, FileSignature, PackageCheck, type LucideIcon } from "lucide-react";
import { Suspense, type ReactNode } from "react";

import { AuthTabs } from "@/components/shop/auth-forms";
import { SITE_NAME } from "@/lib/site";

const POINTS: [LucideIcon, string, string][] = [
  [BadgePercent, "Оптовые цены", "Цены вашей организации — за наличные и по безналу — во всём каталоге"],
  [FileSignature, "Работа по договору", "Договоры с предоплатой или отсрочкой, счёт на организацию"],
  [PackageCheck, "Заказы онлайн", "Корзина, история заказов и их статусы в кабинете"],
];

/**
 * Login and registration over the landscape: what the shop is on the left (from lg up), the form in a card on
 * the right with tabs between the two pages.
 */
export function AuthPage({
  page,
  title,
  lead,
  children,
}: {
  page: "/login" | "/register";
  title?: string; // the registration form has a heading of its own per step
  lead?: string;
  children: ReactNode;
}) {
  return (
    // the card's top stays put on wide screens: the tabs do not move when the two pages differ in height
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10 lg:flex-row lg:items-start lg:gap-14 lg:pt-[max(3rem,14vh)]">
      <aside className="text-white lg:flex-1 lg:pt-8">
        <div className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-xl bg-white text-[13px] font-bold text-slate-900">IT</span>
          <span className="text-lg">{SITE_NAME}</span>
        </div>
        <h2 className="mt-6 hidden text-4xl leading-tight font-semibold tracking-tight text-balance lg:block">
          Оптовые поставки для бизнеса в Крыму
        </h2>
        <p className="mt-2 text-[15px] text-white/80 lg:mt-4 lg:max-w-md lg:text-base">
          Компьютерная техника, электроника и товары для бизнеса — для компаний и ИП.
        </p>
        <ul className="mt-10 hidden max-w-md space-y-5 lg:block">
          {POINTS.map(([Icon, head, text]) => (
            <li key={head} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/12 ring-1 ring-white/20 backdrop-blur">
                <Icon className="size-5" />
              </span>
              <span>
                <span className="block font-medium">{head}</span>
                <span className="text-sm text-white/75">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* one width for both pages: switching between them is not a jump */}
      <section className="w-full max-w-[27rem] self-center rounded-3xl lg:self-start bg-background p-6 shadow-2xl shadow-slate-950/30 sm:p-8">
        {/* keeps ?next=, which is only known in the browser */}
        <Suspense fallback={<div className="h-10" />}>
          <AuthTabs active={page} />
        </Suspense>
        {title && <h1 className="mt-7 text-[26px] leading-tight font-semibold tracking-tight">{title}</h1>}
        {lead && <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{lead}</p>}
        <div className={title ? "mt-7" : "mt-6"}>{children}</div>
      </section>
    </div>
  );
}
