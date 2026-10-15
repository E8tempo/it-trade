import type { Metadata } from "next";

import { RegisterForm } from "@/components/shop/auth-forms";
import { AuthPage } from "@/components/shop/auth-page";

export const metadata: Metadata = { title: "Регистрация", robots: { index: false } };

export default function RegisterPage() {
  return (
    <AuthPage
      page="/register"
      wide
      title="Регистрация организации"
      lead="Для компаний и ИП. Менеджер проверит организацию в рабочее время — после этого откроются цены и заказы."
    >
      <RegisterForm />
    </AuthPage>
  );
}
