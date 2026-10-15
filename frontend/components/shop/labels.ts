import { pluralize } from "@/lib/format";
import type { Cart, CartProblem, ContractRef, DeliveryMethod, OrderStatus, OrganizationStatus, PaymentMethod, User } from "@/lib/types";

/** Payment methods as customers see them. */
export const PAYMENT: Record<PaymentMethod, { title: string; hint: string }> = {
  cash: { title: "Наличными", hint: "при получении заказа" },
  cashless: { title: "Безналичный расчёт", hint: "по счёту на организацию" },
};

/** The cashless hint of a private person: no invoice to an organization. */
export const PERSON_CASHLESS_HINT = "картой или переводом";

/** «Иван Петров»; null while neither name is known. */
export function fullName(u: Pick<User, "name" | "last_name">): string | null {
  return [u.name, u.last_name].filter(Boolean).join(" ") || null;
}

/** Whom the cart's prices are for, after «для»: «ООО «Ромашка»» or «физ. лица». */
export function buyerFor(cart: Pick<Cart, "organization">): string {
  return cart.organization ? cart.organization.name : "физ. лица";
}

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "cashless"];

export const DELIVERY: Record<DeliveryMethod, string> = {
  pickup: "Самовывоз",
  courier: "Курьером по городу",
  transport: "Транспортной компанией по Крыму",
};

/** Order statuses for customers (the admin panel words some of them for managers). */
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  new: { label: "Оформлен", tone: "bg-blue-500/12 text-blue-700" },
  confirmed: { label: "Подтверждён", tone: "bg-violet-500/12 text-violet-700" },
  ordered: { label: "Заказан у поставщика", tone: "bg-amber-500/15 text-amber-800" },
  ready: { label: "Готов к выдаче", tone: "bg-teal-500/12 text-teal-700" },
  shipped: { label: "В доставке", tone: "bg-sky-500/12 text-sky-700" },
  completed: { label: "Выполнен", tone: "bg-emerald-500/12 text-emerald-700" },
  cancelled: { label: "Отменён", tone: "bg-muted text-muted-foreground" },
};

/** Why a cart line cannot be ordered. */
export const PROBLEM: Record<CartProblem, string> = {
  not_found: "Товар больше не продаётся",
  out_of_stock: "Нет в наличии",
  no_price: "Нет цены",
};

/** Why POST /api/cart/items did not add a product. */
export const NOT_ADDED: Record<CartProblem, string> = {
  not_found: "Этот товар больше не продаётся",
  out_of_stock: "Товар закончился — добавить в корзину не получится",
  no_price: "У товара пока нет цены — уточните её по телефону",
};

/** An organization's check by a manager. */
export const ORG_STATUS: Record<OrganizationStatus, { label: string; tone: string }> = {
  pending: { label: "На проверке", tone: "bg-amber-500/15 text-amber-800" },
  approved: { label: "Подтверждена", tone: "bg-emerald-500/12 text-emerald-700" },
  rejected: { label: "Отклонена", tone: "bg-destructive/10 text-destructive" },
};

/** «Предоплата», «Отсрочка 14 дней». */
export function contractTerms(c: Pick<ContractRef, "terms" | "deferral_days">): string {
  if (c.terms === "prepayment" || !c.deferral_days) return "Предоплата";
  return `Отсрочка ${c.deferral_days} ${pluralize(c.deferral_days, ["день", "дня", "дней"])}`;
}
