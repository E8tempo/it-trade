import { SessionProvider } from "@/components/shop/session-provider";
import { Toaster } from "@/components/ui/sonner";

/**
 * Login and registration: the only pages a visitor without a session sees (proxy.ts), so none of the shop
 * (header, catalog menu, footer) is here. A landscape photo behind the form.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <SessionProvider>
      <div className="relative isolate flex min-h-dvh flex-1 flex-col bg-[#50708a]">
        {/* "Landscape, mountains, nature, lake" by Pixel.la, CC0 (public domain): commons.wikimedia.org,
            File:Landscape-mountains-nature-lake_(24326735085).jpg */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed pre-sized background, no optimisation needed */}
        <img
          src="/auth/lake-2400.webp"
          srcSet="/auth/lake-1200.webp 1200w, /auth/lake-2400.webp 2400w"
          sizes="100vw"
          alt=""
          fetchPriority="high"
          className="fixed inset-0 -z-20 size-full object-cover"
        />
        {/* darker on the left, where the text is; the form has its own card */}
        <div className="fixed inset-0 -z-10 bg-slate-950/45 lg:bg-transparent lg:bg-linear-to-r lg:from-slate-950/75 lg:via-slate-950/35 lg:to-slate-950/5" />
        <main className="flex flex-1">{children}</main>
      </div>
      <Toaster position="top-center" richColors />
    </SessionProvider>
  );
}
