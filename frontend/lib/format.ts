const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat("ru-RU");
const plural = new Intl.PluralRules("ru-RU");
// the shop's time zone, whatever the visitor's clock (or the server's) says
const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Simferopol" });
const dayTime = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Simferopol",
});

export function formatPrice(value: number | null | undefined): string {
  return value == null ? "Цена по запросу" : rub.format(value);
}

export function formatNumber(value: number): string {
  return num.format(value);
}

/** pluralize(5, ["товар", "товара", "товаров"]) -> "товаров" */
export function pluralize(n: number, [one, few, many]: [string, string, string]): string {
  const form = plural.select(n);
  return form === "one" ? one : form === "few" ? few : many;
}

export function countLabel(n: number, forms: [string, string, string] = ["товар", "товара", "товаров"]): string {
  return `${formatNumber(n)} ${pluralize(n, forms)}`;
}

/** "14 октября 2026 г." */
export function formatDate(iso: string): string {
  return day.format(new Date(iso));
}

/** "14 октября 2026 г. в 10:24" */
export function formatDateTime(iso: string): string {
  return dayTime.format(new Date(iso));
}

/** Supplier descriptions sometimes come wrapped in braces: "{...}". */
export function cleanDescription(text: string | null): string | null {
  const t = text?.trim().replace(/^\{([\s\S]*)\}$/, "$1").trim();
  return t || null;
}
