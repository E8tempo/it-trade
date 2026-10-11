import { ApiError } from "@/lib/api/client";

/** A readable message from an admin API error (FastAPI `detail` string or validation errors). */
export function apiErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = (e.detail as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((d) => (d as { msg?: string }).msg).filter(Boolean).join("; ");
    return `Ошибка ${e.status}`;
  }
  return "Нет связи с сервером";
}
