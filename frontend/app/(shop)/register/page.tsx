import type { Metadata } from "next";

import { RegisterForm } from "@/components/shop/auth-forms";
import { AuthPage } from "@/components/shop/auth-page";

export const metadata: Metadata = { title: "Регистрация", robots: { index: false } };

export default function RegisterPage() {
  return (
    <AuthPage
      title="Регистрация компании"
      lead="Оптовые цены, договоры с отсрочкой, история заказов — для компаний и ИП. Менеджер проверит организацию в рабочее время, и цены откроются."
      switchTo="/login"
    >
      <RegisterForm />
    </AuthPage>
  );
}
