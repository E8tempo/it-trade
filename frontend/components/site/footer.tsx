import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Logo } from "@/components/site/logo";
import { getCategoryTree, getShop } from "@/lib/catalog";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { categoryHref } from "@/lib/urls";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t bg-muted/40">
      <div className="container-shop grid grid-cols-1 gap-10 py-12 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-16">
        <div className="space-y-4">
          <Logo />
          <p className="text-sm leading-relaxed text-muted-foreground">{SITE_DESCRIPTION}</p>
          <Suspense fallback={null}>
            <FooterContacts />
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <FooterCategories />
        </Suspense>
      </div>
      <div className="border-t">
        <div className="container-shop flex flex-col gap-1 py-5 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>
            © <Year /> {SITE_NAME}
          </span>
          <Link href="/catalog" className="hover:text-foreground">
            Весь каталог
          </Link>
        </div>
      </div>
    </footer>
  );
}

async function Year() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

async function FooterContacts() {
  await connection();
  const shop = await getShop();
  const rows = [
    shop.phone && { icon: Phone, text: shop.phone, href: `tel:${shop.phone.replace(/[^+\d]/g, "")}` },
    shop.email && { icon: Mail, text: shop.email, href: `mailto:${shop.email}` },
    shop.address && { icon: MapPin, text: shop.address },
    shop.working_hours && { icon: Clock, text: shop.working_hours },
  ].filter(Boolean) as { icon: typeof Phone; text: string; href?: string }[];
  if (!rows.length) return null;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map(({ icon: Icon, text, href }) => (
        <li key={text} className="flex items-start gap-2.5">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {href ? (
            <a href={href} className="hover:text-primary">
              {text}
            </a>
          ) : (
            <span>{text}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

async function FooterCategories() {
  await connection();
  const roots = await getCategoryTree(1);
  return (
    <nav aria-label="Каталог">
      <h2 className="mb-4 text-sm font-semibold">Каталог</h2>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-3">
        {roots.map((c) => (
          <li key={c.id}>
            <Link href={categoryHref(c)} className="text-muted-foreground transition-colors hover:text-foreground">
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
