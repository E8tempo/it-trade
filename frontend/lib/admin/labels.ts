import type { DeliveryMethod, OrderSource, OrderStatus } from "@/lib/admin/types";

export const ORDER_STATUSES: { value: OrderStatus; label: string; tone: string }[] = [
  { value: "new", label: "Новый", tone: "bg-blue-500/12 text-blue-700" },
  { value: "confirmed", label: "Подтверждён", tone: "bg-violet-500/12 text-violet-700" },
  { value: "ordered", label: "Заказан у поставщика", tone: "bg-amber-500/15 text-amber-800" },
  { value: "ready", label: "Готов к выдаче", tone: "bg-teal-500/12 text-teal-700" },
  { value: "shipped", label: "В доставке", tone: "bg-sky-500/12 text-sky-700" },
  { value: "completed", label: "Выполнен", tone: "bg-emerald-500/12 text-emerald-700" },
  { value: "cancelled", label: "Отменён", tone: "bg-muted text-muted-foreground" },
];

export const STATUS = Object.fromEntries(ORDER_STATUSES.map((s) => [s.value, s])) as Record<
  OrderStatus,
  (typeof ORDER_STATUSES)[number]
>;

export const DELIVERY: Record<DeliveryMethod, string> = {
  pickup: "Самовывоз",
  courier: "Курьер по городу",
  transport: "Транспортная компания",
};

export const SOURCE: Record<OrderSource, string> = {
  site: "Сайт",
  phone: "Телефон",
  admin: "Админка",
};

const rub = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Simferopol" });

export function money(value: number | string | null | undefined): string {
  return value == null ? "—" : rub.format(Number(value));
}

export function when(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

/** Watermark variant labels of the image pipeline ("big-rot-x2" -> "большой, повёрнут, 2 слоя"). */
export function variantLabel(v: string): string {
  if (v === "none") return "без знака";
  const [size, ...rest] = v.split("-");
  const names: Record<string, string> = { big: "большой", mid: "средний", small: "малый", tiny: "крошечный" };
  const parts = [names[size] ?? size];
  for (const r of rest) {
    if (r === "rot") parts.push("повёрнут");
    else if (r === "black") parts.push("тёмный");
    else if (r.startsWith("x")) parts.push(`${r.slice(1)} слоя`);
  }
  return parts.join(", ");
}
