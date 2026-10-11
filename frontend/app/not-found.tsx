import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="container-shop flex flex-col items-center py-24 text-center sm:py-32">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Страница не найдена</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        Возможно, товар закончился у поставщика или ссылка устарела. Попробуйте поиск или загляните в каталог.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/catalog" className={cn(buttonVariants({ size: "lg" }), "h-11 rounded-xl px-5")}>
          Каталог
        </Link>
        <Link href="/" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 rounded-xl px-5")}>
          На главную
        </Link>
      </div>
    </div>
  );
}
