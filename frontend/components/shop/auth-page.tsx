import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { AuthSwitchLink } from "@/components/shop/auth-forms";

const SWITCH = "font-medium text-primary hover:underline";

/** Login and registration: a narrow card, and a link to the other one under it. */
export function AuthPage({
  title,
  lead,
  switchTo,
  children,
}: {
  title: string;
  lead: string;
  switchTo: "/login" | "/register";
  children: ReactNode;
}) {
  const [question, action] = switchTo === "/register" ? ["Нет аккаунта?", "Зарегистрируйтесь"] : ["Уже есть аккаунт?", "Войдите"];
  return (
    <div className="container-shop flex justify-center pt-6 pb-4 sm:pt-14">
      <div className="w-full max-w-[26rem]">
        <div className="sm:rounded-3xl sm:border sm:p-8">
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{lead}</p>
          <div className="mt-7">{children}</div>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {question}{" "}
          {/* keeps ?next=, which is only known in the browser */}
          <Suspense
            fallback={
              <Link href={switchTo} className={SWITCH}>
                {action}
              </Link>
            }
          >
            <AuthSwitchLink to={switchTo}>{action}</AuthSwitchLink>
          </Suspense>
        </p>
      </div>
    </div>
  );
}
