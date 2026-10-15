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

const rub2 = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDay = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Simferopol" });

/** Whole roubles as «1 250 ₽», with kopecks only when there are some: «1 250,50 ₽». */
export function formatMoney(value: number): string {
  return Number.isInteger(value) ? rub.format(value) : rub2.format(value);
}

/** Documents: always with kopecks and without the sign, «1 250,00». */
export function formatAmount(value: number): string {
  return num2.format(value);
}

/** "15.10.2026" */
export function formatShortDate(iso: string): string {
  return shortDay.format(new Date(iso));
}

const ONES = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", ...ONES.slice(3)];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
// thousands are feminine (одна тысяча), the rest masculine (один миллион, один рубль)
const SCALES: { forms: [string, string, string]; feminine: boolean }[] = [
  { forms: ["", "", ""], feminine: false },
  { forms: ["тысяча", "тысячи", "тысяч"], feminine: true },
  { forms: ["миллион", "миллиона", "миллионов"], feminine: false },
  { forms: ["миллиард", "миллиарда", "миллиардов"], feminine: false },
];

function triadWords(n: number, feminine: boolean): string[] {
  const words = [HUNDREDS[Math.floor(n / 100)]];
  const rest = n % 100;
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else words.push(TENS[Math.floor(rest / 10)], (feminine ? ONES_F : ONES)[rest % 10]);
  return words.filter(Boolean);
}

/** An amount in words for documents: «Одна тысяча двести пятьдесят рублей 50 копеек». */
export function amountInWords(value: number): string {
  const cents = Math.round(value * 100);
  let rubles = Math.floor(cents / 100);
  const kopecks = cents % 100;
  const rublesN = rubles;
  const words: string[] = [];
  if (rubles === 0) words.push("ноль");
  for (let scale = 0; rubles > 0 && scale < SCALES.length; scale++, rubles = Math.floor(rubles / 1000)) {
    const triad = rubles % 1000;
    if (!triad) continue;
    const { forms, feminine } = SCALES[scale];
    words.unshift(...triadWords(triad, feminine), ...(scale ? [pluralize(triad, forms)] : []));
  }
  const text = `${words.join(" ")} ${pluralize(rublesN, ["рубль", "рубля", "рублей"])} ${String(kopecks).padStart(2, "0")} ${pluralize(kopecks, ["копейка", "копейки", "копеек"])}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
