import { BadgePercent, FileSignature, PackageCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { AuthSwitchLink, AuthTabs } from "@/components/shop/auth-forms";
import { SITE_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";

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
  wide,
  children,
}: {
  page: "/login" | "/register";
  title: string;
  lead: string;
  wide?: boolean; // the registration form, in two columns
  children: ReactNode;
}) {
  const [question, action, other] =
    page === "/login" ? ["Нет аккаунта?", "Зарегистрируйте организацию", "/register" as const] : ["Уже есть аккаунт?", "Войдите", "/login" as const];
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10 lg:flex-row lg:items-center lg:gap-14 lg:py-12">
      <aside className="text-white lg:flex-1">
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

      <section
        className={cn(
          "w-full self-center rounded-3xl bg-background p-6 shadow-2xl shadow-slate-950/30 sm:p-8",
          wide ? "max-w-[46rem]" : "max-w-[27rem]",
        )}
      >
        {/* keeps ?next=, which is only known in the browser */}
        <Suspense fallback={<div className="h-10" />}>
          <AuthTabs active={page} />
        </Suspense>
        <h1 className="mt-7 text-[26px] leading-tight font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{lead}</p>
        <div className="mt-7">{children}</div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {question}{" "}
          <Suspense
            fallback={
              <Link href={other} className="font-medium text-primary hover:underline">
                {action}
              </Link>
            }
          >
            <AuthSwitchLink to={other}>{action}</AuthSwitchLink>
          </Suspense>
        </p>
      </section>
    </div>
  );
}
