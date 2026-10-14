"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminUser } from "@/lib/admin/types";
import { api, ApiError } from "@/lib/api/client";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(
    params.get("denied") ? "У этой учётной записи нет доступа к панели управления." : null,
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { user } = await api<{ user: AdminUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (user.role !== "admin") {
        setError("У этой учётной записи нет доступа к панели управления.");
        return;
      }
      const next = params.get("next");
      router.replace(next?.startsWith("/admin") ? next : "/admin");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "Неверный e-mail или пароль."
          : err instanceof ApiError && err.status === 429
            ? "Слишком много попыток. Попробуйте через 15 минут."
            : "Не удалось войти. Проверьте, что API запущен.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    // method="post": if the page's JS fails to load, the browser must not put the password in the URL
    <form method="post" onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-background p-6 shadow-sm ring-1 ring-foreground/10">
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required className="h-10" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Пароль</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-10" />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending && <LoaderCircle className="animate-spin" />}
        Войти
      </Button>
    </form>
  );
}
