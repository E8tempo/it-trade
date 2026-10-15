import type { Metadata } from "next";

import { LoginForm } from "@/components/shop/auth-forms";
import { AuthPage } from "@/components/shop/auth-page";

export const metadata: Metadata = { title: "Вход", robots: { index: false } };

export default function LoginPage() {
  return (
    <AuthPage page="/login" title="Вход в кабинет" lead="Цены, корзина, заказы и их статусы.">
      <LoginForm />
    </AuthPage>
  );
}
