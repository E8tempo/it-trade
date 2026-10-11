import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/admin/login-form";
import { Logo } from "@/components/site/logo";

export const metadata: Metadata = { title: "Вход" };

export default function AdminLoginPage() {
  return (
    <div className="grid flex-1 place-items-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Панель управления</h1>
            <p className="mt-1 text-sm text-muted-foreground">Войдите учётной записью администратора</p>
          </div>
        </div>
        {/* reads ?denied and ?next from the URL */}
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
