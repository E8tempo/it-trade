import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

/** Typography for the algorithm articles. */
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <article
      className={cn(
        "max-w-3xl text-[15px] leading-7",
        "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:scroll-mt-20 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight",
        "[&_h3]:mt-7 [&_h3]:mb-2 [&_h3]:scroll-mt-20 [&_h3]:font-semibold",
        "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
        "[&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline",
        "[&_table]:my-4 [&_table]:w-full [&_table]:text-sm [&_th]:border-b [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium",
        "[&_td]:border-b [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top",
      )}
    >
      {children}
    </article>
  );
}

export function Note({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <aside className="my-5 flex gap-3 rounded-xl bg-primary/5 p-4 text-sm leading-6 ring-1 ring-primary/15">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <div>
        {title && <p className="mb-1 font-semibold">{title}</p>}
        {children}
      </div>
    </aside>
  );
}

/** "Where in the code" footer of an article. */
export function Code({ files }: { files: string[] }) {
  return (
    <p className="mt-10 border-t pt-4 text-sm text-muted-foreground">
      В коде:{" "}
      {files.map((f, i) => (
        <span key={f}>
          {i > 0 && ", "}
          <code>{f}</code>
        </span>
      ))}
    </p>
  );
}
