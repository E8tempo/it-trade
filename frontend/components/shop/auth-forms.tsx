"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { errorMessage, hasStatus } from "@/components/shop/errors";
import { Field, FIELD, FormError, PasswordInput, SUBMIT } from "@/components/shop/form";
import { authHref, nextFromLocation, safeNext } from "@/components/shop/next-url";
import { ResetPasswordDialog } from "@/components/shop/reset-password";
import { useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Signed in (already, or just now): on to ?next=, by default the account. */
export function useLeaveWhenSignedIn() {
  const router = useRouter();
  const { user, loading } = useSession();
  useEffect(() => {
    if (!loading && user) router.replace(nextFromLocation());
  }, [loading, user, router]);
}

export function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "");
}

export function LoginForm() {
  const { login } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useLeaveWhenSignedIn();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const email = text(data, "email").trim();
    const password = text(data, "password");
    if (!email || !password) {
      setError("Введите e-mail и пароль.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await login(email, password);
      form.reset(); // the page stays in memory for back navigation: no password left in it
    } catch (err) {
      setError(
        hasStatus(err, 401, 422)
          ? "Неверный e-mail или пароль."
          : hasStatus(err, 429)
            ? "Слишком много попыток. Попробуйте через 15 минут."
            : errorMessage(err, "Не удалось войти. Попробуйте ещё раз."),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
    {/* method="post": if the page's JS fails to load, the browser must not put the password in the URL */}
    <form ref={formRef} method="post" noValidate onSubmit={onSubmit} className="space-y-4">
      <Field id="login-email" label="E-mail">
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          className={FIELD}
        />
      </Field>
      <div className="relative">
        <Field id="login-password" label="Пароль">
          <PasswordInput id="login-password" name="password" autoComplete="current-password" required />
        </Field>
        <button
          type="button"
          onClick={() => {
            setResetEmail(String(new FormData(formRef.current!).get("email") ?? "").trim());
            setResetOpen(true);
          }}
          className="absolute top-0 right-0 text-sm font-medium text-primary hover:underline"
        >
          Забыли пароль?
        </button>
      </div>
      {error && <FormError>{error}</FormError>}
      <Button type="submit" className={SUBMIT} disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" />}
        Войти
      </Button>
    </form>
      <ResetPasswordDialog open={resetOpen} onOpenChange={setResetOpen} initialEmail={resetEmail} />
    </>
  );
}

/** «Вход | Регистрация» at the top of the card, keeping ?next=. Reads the URL: render inside <Suspense>. */
export function AuthTabs({ active }: { active: "/login" | "/register" }) {
  const next = safeNext(useSearchParams().get("next"), "");
  const tabs = [
    ["/login", "Вход"],
    ["/register", "Регистрация"],
  ] as const;
  return (
    <nav className="grid grid-cols-2 rounded-xl bg-muted p-1 text-sm font-medium" aria-label="Вход или регистрация">
      {tabs.map(([href, label]) => (
        <Link
          key={href}
          href={authHref(href, next || null)}
          aria-current={href === active ? "page" : undefined}
          className={cn(
            "rounded-lg px-3 py-2 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            href === active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
