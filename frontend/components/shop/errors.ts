import { ApiError } from "@/lib/api/client";

const CYRILLIC = /[а-яё]/i;

/**
 * Text for a failed API call. The API's messages meant for customers are Russian (cart, checkout);
 * English ones are technical (auth, validation) and give way to `fallback`, as do network errors.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const detail = (e.detail as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string" && CYRILLIC.test(detail)) return detail;
    if (Array.isArray(detail)) {
      // a check of the API's own in a validation error: "Value error, Укажите адрес доставки"
      const msg = detail.map((d) => String((d as { msg?: unknown } | null)?.msg ?? "")).find((m) => CYRILLIC.test(m));
      if (msg) return msg.replace(/^Value error,\s*/, "");
    }
    if (e.status === 429) return "Слишком много запросов. Попробуйте через несколько минут.";
    if (e.status >= 500) return "Сервер не отвечает. Попробуйте ещё раз через минуту.";
    return fallback;
  }
  // fetch() rejects with a TypeError when the request did not reach the server
  if (e instanceof TypeError) return "Нет связи с сервером. Проверьте подключение к интернету.";
  return fallback;
}

export function hasStatus(e: unknown, ...statuses: number[]): boolean {
  return e instanceof ApiError && statuses.includes(e.status);
}
