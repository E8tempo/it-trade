import type { Metadata } from "next";

import { RegisterForm } from "@/components/shop/register-form";
import { AuthPage } from "@/components/shop/auth-page";

export const metadata: Metadata = { title: "Регистрация", robots: { index: false } };

export default function RegisterPage() {
  return (
    <AuthPage page="/register">
      <RegisterForm />
    </AuthPage>
  );
}
