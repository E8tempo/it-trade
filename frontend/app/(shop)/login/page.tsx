import type { Metadata } from "next";

import { LoginForm } from "@/components/shop/auth-forms";
import { AuthPage } from "@/components/shop/auth-page";

export const metadata: Metadata = { title: "Вход", robots: { index: false } };

export default function LoginPage() {
  return (
    <AuthPage title="Вход" lead="Кабинет клиента: оптовые цены вашей организации, корзина, заказы и их статусы." switchTo="/register">
      <LoginForm />
    </AuthPage>
  );
}
