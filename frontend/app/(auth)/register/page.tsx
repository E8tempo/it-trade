import type { Metadata } from "next";

import { RegisterForm } from "@/components/shop/auth-forms";
import { AuthPage } from "@/components/shop/auth-page";

export const metadata: Metadata = { title: "Регистрация", robots: { index: false } };

export default function RegisterPage() {
  return (
    <AuthPage
      page="/register"
      title="Регистрация организации"
      lead="Для компаний и ИП. Менеджер проверит организацию, и откроются цены и заказы."
    >
      <RegisterForm />
    </AuthPage>
  );
}
