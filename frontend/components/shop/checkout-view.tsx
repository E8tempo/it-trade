"use client";

import { Building2, CircleAlert, CircleCheckBig, FileText, LoaderCircle, Package, Store, Truck, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { ProductImage } from "@/components/catalog/product-image";
import { lineTotal } from "@/components/shop/cart-view";
import { ChoiceCard, PaymentChoice } from "@/components/shop/choice-card";
import { errorMessage, hasStatus } from "@/components/shop/errors";
import { describedBy, emailError, Field, FIELD, FormError, phoneError, type FieldErrors } from "@/components/shop/form";
import { buyerFor, contractTerms, DELIVERY, fullName, PROBLEM } from "@/components/shop/labels";
import { useCart, useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";
import { formatDate, formatNumber, formatPrice } from "@/lib/format";
import type { Cart, CheckoutIn, Contract, CustomerOrder, DeliveryMethod, Organization, PaymentMethod, User } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The checkout: who buys (an organization of the client's or the client as a private person), contacts, delivery,
 * payment and a comment, with the order on the side. `pickup` is the shop's address (rendered on the server), shown
 * under «Самовывоз».
 */
export function CheckoutView({ pickup }: { pickup: ReactNode }) {
  const router = useRouter();
  const { access } = useSession();
  const { cart, loading: cartLoading } = useCart();
  const [placed, setPlaced] = useState(false);
  const empty = access === "client" && !cartLoading && !cart?.items.length;

  // Only a client orders: a guest signs in first. Nothing to order (an empty cart, also after a
  // 409 «Корзина пуста»): back to the cart. Not after this page placed the order and emptied the
  // cart, while it moves on to the order.
  useEffect(() => {
    if (access === "guest") router.replace("/login?next=%2Fcheckout");
    else if (empty && !placed) router.replace("/cart");
  }, [access, empty, placed, router]);

  // the page is kept alive for back navigation: coming back to it starts afresh
  useLayoutEffect(() => () => setPlaced(false), []);

  if (placed) return <Placed />;
  if (access !== "client" || cartLoading || empty || !cart) return <CheckoutSkeleton />;
  return <CheckoutForm cart={cart} pickup={pickup} onPlaced={() => setPlaced(true)} />;
}

type Values = { name: string; phone: string; email: string; delivery: DeliveryMethod; city: string; address: string; comment: string };
type CheckoutField = "name" | "phone" | "email" | "city" | "address" | "comment";
const FIELDS: CheckoutField[] = ["name", "phone", "email", "city", "address", "comment"];

function initialValues(user: User | null): Values {
  return { name: (user && fullName(user)) ?? "", phone: user?.phone ?? "", email: user?.email ?? "", delivery: "pickup", city: "", address: "", comment: "" };
}

function validate(v: Values): FieldErrors<CheckoutField> {
  const name = v.name.trim();
  return {
    name: !name ? "Укажите, как к вам обращаться" : name.length > 255 ? "Слишком длинное имя" : undefined,
    phone: phoneError(v.phone, true),
    email: emailError(v.email, false),
    city: v.delivery !== "transport" ? undefined : !v.city.trim() ? "Укажите город" : v.city.trim().length > 128 ? "Слишком длинное название" : undefined,
    address:
      v.delivery === "pickup"
        ? undefined
        : !v.address.trim()
          ? v.delivery === "courier"
            ? "Укажите адрес доставки"
            : "Укажите адрес или отделение транспортной компании"
          : v.address.trim().length > 512
            ? "Слишком длинный адрес"
            : undefined,
    comment: v.comment.length > 2000 ? "Комментарий не длиннее 2000 символов" : undefined,
  };
}

const DELIVERY_OPTIONS: { value: DeliveryMethod; icon: typeof Store; hint: string }[] = [
  { value: "pickup", icon: Store, hint: "Заберёте заказ в нашем магазине" },
  { value: "courier", icon: Truck, hint: "Привезём по вашему адресу в городе" },
  { value: "transport", icon: Package, hint: "Отправим в ваш город, до отделения или адреса" },
];

/** The contracts offered at checkout: the active ones of the organization the cart is priced for. */
function activeContracts(organizations: Organization[] | null, cart: Cart): Contract[] {
  const org = cart.organization && organizations?.find((o) => o.id === cart.organization?.id);
  return org ? org.contracts.filter((c) => c.is_active) : [];
}

function CheckoutForm({ cart, pickup, onPlaced }: { cart: Cart; pickup: ReactNode; onPlaced: () => void }) {
  const router = useRouter();
  const { user, keepSession, organizations, refreshOrganizations } = useSession();
  const { payment, setPayment, setBuyer, syncing, refresh } = useCart();
  const contracts = activeContracts(organizations, cart);
  const [chosenContract, setContract] = useState<number | null>(null);
  // the first contract is offered until another one is chosen; a contract of another buyer does not count
  const contractId = contracts.some((c) => c.id === chosenContract) ? chosenContract : (contracts[0]?.id ?? null);
  // the session is known before the form appears, so a signed-in customer's contacts are filled in
  const [values, setValues] = useState<Values>(() => initialValues(user));
  const [errors, setErrors] = useState<FieldErrors<CheckoutField>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof Values, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const ready = cart.can_checkout && cart.payment === payment && !syncing;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const found = validate(values);
    const invalid = FIELDS.filter((k) => found[k]);
    setErrors(found);
    setFormError(null);
    if (invalid.length) {
      form.querySelector<HTMLElement>(`[name="${invalid[0]}"]`)?.focus();
      return;
    }
    if (!ready || submitting) return;

    setSubmitting(true);
    try {
      // signed out elsewhere meanwhile: the provider says so (and this page sends them to sign in)
      if (!(await keepSession())) {
        await refresh().catch(() => undefined);
        return;
      }
      const body: CheckoutIn = {
        customer_name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim() || null,
        delivery: values.delivery,
        city: values.delivery === "transport" ? values.city.trim() : null,
        address: values.delivery === "pickup" ? null : values.address.trim(),
        comment: values.comment.trim() || null,
        payment_method: payment,
        contract_id: contractId,
        // the total on screen: if prices changed meanwhile, the API refuses (409) instead of charging more
        expected_total: cart.totals[payment],
      };
      const order = await api<CustomerOrder>("/api/orders", { method: "POST", body: JSON.stringify(body) });
      onPlaced();
      router.push(`/account/orders/${order.id}?placed=1`);
      void refresh().catch(() => undefined); // the API has emptied the cart
    } catch (err) {
      if (hasStatus(err, 409)) {
        // the cart changed (empty, unavailable products, new prices) or the contract was closed: the
        // re-read cart and organizations show which
        toast.error(errorMessage(err, "Корзина изменилась. Проверьте заказ."));
        void refresh().catch(() => undefined);
        void refreshOrganizations().catch(() => undefined);
      } else {
        setFormError(
          hasStatus(err, 429)
            ? errorMessage(err, "Слишком много заказов, попробуйте позже.")
            : errorMessage(err, "Не удалось оформить заказ. Попробуйте ещё раз."),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const transport = values.delivery === "transport";
  const buyers = organizations?.filter((o) => o.status === "approved") ?? null;
  let step = 0;
  return (
    <form noValidate onSubmit={onSubmit} className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="min-w-0 space-y-9">
        {!!buyers?.length && (
          <Section step={++step} title="Покупатель">
            <fieldset disabled={submitting}>
              <BuyerChoice organizations={buyers} cart={cart} person={user} onChange={setBuyer} />
            </fieldset>
            {cart.organization && (
              <div className="mt-5">
                <h3 className="mb-2.5 text-sm font-medium">Договор</h3>
                {contracts.length ? (
                  <fieldset disabled={submitting}>
                    <ContractChoice contracts={contracts} value={contractId} onChange={setContract} />
                  </fieldset>
                ) : (
                  <p className="rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                    Договора с нами у организации пока нет — менеджер свяжется с вами и оформит его.
                  </p>
                )}
              </div>
            )}
          </Section>
        )}

        <Section step={++step} title="Контактные данные">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="co-name" label="Имя и фамилия" error={errors.name}>
              <Input
                name="name"
                autoComplete="name"
                maxLength={255}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                className={FIELD}
                {...describedBy("co-name", errors.name)}
              />
            </Field>
            <Field id="co-phone" label="Телефон" error={errors.phone}>
              <Input
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+7 978 123-45-67"
                maxLength={32}
                value={values.phone}
                onChange={(e) => set("phone", e.target.value)}
                className={FIELD}
                {...describedBy("co-phone", errors.phone)}
              />
            </Field>
            <Field id="co-email" label="E-mail" optional error={errors.email} className="sm:col-span-2">
              <Input
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
                className={FIELD}
                {...describedBy("co-email", errors.email)}
              />
            </Field>
          </div>
        </Section>

        <Section step={++step} title="Способ получения">
          <div role="radiogroup" aria-label="Способ получения" className="grid gap-2">
            {DELIVERY_OPTIONS.map(({ value, icon: Icon, hint }) => (
              <ChoiceCard
                key={value}
                name="delivery"
                value={value}
                checked={values.delivery === value}
                onSelect={(v) => set("delivery", v)}
                icon={<Icon className="size-4 text-muted-foreground" />}
                title={DELIVERY[value]}
                hint={hint}
                aside={<span className="text-sm font-normal text-muted-foreground">{value === "pickup" ? "бесплатно" : "по тарифу"}</span>}
              >
                {value === "pickup" && <span className="mt-2 block text-[13px] leading-snug">{pickup}</span>}
              </ChoiceCard>
            ))}
          </div>
          {values.delivery !== "pickup" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              {transport && (
                <Field id="co-city" label="Город" error={errors.city}>
                  <Input
                    name="city"
                    autoComplete="address-level2"
                    maxLength={128}
                    value={values.city}
                    onChange={(e) => set("city", e.target.value)}
                    className={FIELD}
                    {...describedBy("co-city", errors.city)}
                  />
                </Field>
              )}
              <Field
                id="co-address"
                label={transport ? "Адрес или отделение ТК" : "Адрес доставки"}
                error={errors.address}
                className={cn(!transport && "sm:col-span-2")}
              >
                <Input
                  name="address"
                  autoComplete={transport ? "off" : "street-address"}
                  placeholder={transport ? "Например: СДЭК, ул. Киевская, 41" : "Улица, дом, квартира"}
                  maxLength={512}
                  value={values.address}
                  onChange={(e) => set("address", e.target.value)}
                  className={FIELD}
                  {...describedBy("co-address", errors.address)}
                />
              </Field>
            </div>
          )}
        </Section>

        <Section step={++step} title="Оплата">
          <fieldset disabled={submitting}>
            <PaymentChoice value={payment} onChange={setPayment} totals={cart.totals} person={!cart.organization} />
          </fieldset>
        </Section>

        <Section step={++step} title="Комментарий">
          <Field id="co-comment" label="Комментарий к заказу" optional error={errors.comment} className="[&>label]:sr-only">
            <Textarea
              name="comment"
              rows={3}
              maxLength={2000}
              placeholder="Удобное время для звонка, подъезд и этаж, другие пожелания"
              value={values.comment}
              onChange={(e) => set("comment", e.target.value)}
              className="min-h-24 rounded-xl px-3.5 py-3"
              {...describedBy("co-comment", errors.comment)}
            />
          </Field>
        </Section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Ваш заказ">
        <OrderSummary cart={cart} payment={payment} delivery={values.delivery} syncing={syncing}>
          {formError && <FormError>{formError}</FormError>}
          <Button type="submit" className="h-12 w-full gap-2 rounded-xl text-[15px]" disabled={!ready || submitting}>
            {(submitting || syncing) && <LoaderCircle className="animate-spin" />}
            Подтвердить заказ
          </Button>
          {!cart.can_checkout && cart.payment === payment && !syncing ? (
            <p className="flex gap-2 text-[13px] text-amber-800">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Некоторые товары заказать уже нельзя.{" "}
                <Link href="/cart" className="font-medium underline underline-offset-2">
                  Вернитесь в корзину
                </Link>
                , чтобы убрать их.
              </span>
            </p>
          ) : (
            <p className="text-[13px] leading-snug text-muted-foreground">
              Менеджер позвонит, чтобы подтвердить заказ{values.delivery === "pickup" ? "" : " и стоимость доставки"}.
            </p>
          )}
        </OrderSummary>
      </aside>
    </form>
  );
}

const PERSON = "person";

/** Who the order is for (the choice of the site header): an approved organization or the client as a private
 * person; prices follow it. */
function BuyerChoice({
  organizations,
  cart,
  person,
  onChange,
}: {
  organizations: Organization[];
  cart: Cart;
  person: User | null;
  onChange: (organizationId: number | null) => Promise<Cart>;
}) {
  const name = useId();
  const pick = (value: string) => {
    onChange(value === PERSON ? null : Number(value)).catch((e: unknown) =>
      toast.error(errorMessage(e, "Не удалось сменить покупателя. Попробуйте ещё раз.")),
    );
  };
  return (
    <div role="radiogroup" aria-label="Покупатель" className="grid gap-2">
      {organizations.map((o) => (
        <ChoiceCard
          key={o.id}
          name={name}
          value={String(o.id)}
          checked={cart.organization?.id === o.id}
          onSelect={pick}
          icon={<Building2 className="size-4 text-muted-foreground" />}
          title={o.name}
          hint={`ИНН ${o.inn}${o.kpp ? ` · КПП ${o.kpp}` : ""}`}
        />
      ))}
      <ChoiceCard
        name={name}
        value={PERSON}
        checked={!cart.organization}
        onSelect={pick}
        icon={<UserRound className="size-4 text-muted-foreground" />}
        title="Физическое лицо"
        hint={(person && fullName(person)) ?? "Без организации, по ценам для физ. лиц"}
      />
    </div>
  );
}

function ContractChoice({ contracts, value, onChange }: { contracts: Contract[]; value: number | null; onChange: (id: number) => void }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Договор" className="grid gap-2 sm:grid-cols-2">
      {contracts.map((c) => (
        <ChoiceCard
          key={c.id}
          name={name}
          value={String(c.id)}
          checked={value === c.id}
          onSelect={(v) => onChange(Number(v))}
          icon={<FileText className="size-4 text-muted-foreground" />}
          title={`№ ${c.number} от ${formatDate(c.signed_on)}`}
          hint={contractTerms(c)}
        />
      ))}
    </div>
  );
}

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold tracking-tight">
        <span className="grid size-7 place-items-center rounded-full bg-foreground text-[13px] font-semibold text-background tabular-nums">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function OrderSummary({
  cart,
  payment,
  delivery,
  syncing,
  children,
}: {
  cart: Cart;
  payment: PaymentMethod;
  delivery: DeliveryMethod;
  syncing: boolean;
  children: ReactNode;
}) {
  const units = cart.items.reduce((n, i) => n + i.qty, 0);
  const total = cart.totals[payment];
  return (
    <div className="space-y-5 rounded-3xl border p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold">Ваш заказ</h2>
        <Link href="/cart" className="text-sm font-medium text-primary hover:underline">
          Изменить
        </Link>
      </div>
      <p className="-mt-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {cart.organization ? <Building2 className="size-3.5 shrink-0" /> : <UserRound className="size-3.5 shrink-0" />}
        <span className="truncate">Цены для {buyerFor(cart)}</span>
      </p>
      <ul className="-mr-2 max-h-[min(22rem,45vh)] space-y-3 overflow-y-auto pr-2">
        {cart.items.map((item) => (
          <li key={item.sku} className="flex gap-3">
            <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted/70 p-1">
              <ProductImage image={item.image} alt="" sizes="48px" className={cn(item.problem && "opacity-50 grayscale")} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] leading-snug">{item.name}</p>
              {item.problem ? (
                <p className="mt-0.5 text-xs font-medium text-amber-800">{PROBLEM[item.problem]}</p>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {formatNumber(item.qty)} × {formatPrice(item.prices[payment])}
                </p>
              )}
            </div>
            {!item.problem && <span className="text-[13px] font-medium tabular-nums">{formatPrice(lineTotal(item.prices[payment], item.qty))}</span>}
          </li>
        ))}
      </ul>
      <dl className="space-y-2 border-t pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Товары, {formatNumber(units)} шт.</dt>
          <dd className="tabular-nums">{formatPrice(total)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Доставка</dt>
          <dd>{delivery === "pickup" ? "бесплатно" : "рассчитает менеджер"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 pt-1">
          <dt className="text-base font-semibold">Итого</dt>
          <dd className={cn("text-2xl font-semibold tracking-tight tabular-nums transition-opacity", syncing && "opacity-60")}>{formatPrice(total)}</dd>
        </div>
      </dl>
      {children}
    </div>
  );
}

function Placed() {
  return (
    <div className="flex flex-col items-center py-16 text-center" role="status">
      <span className="grid size-14 place-items-center rounded-full bg-emerald-500/12">
        <CircleCheckBig className="size-7 text-emerald-600" />
      </span>
      <p className="mt-4 text-lg font-semibold">Заказ оформлен</p>
      <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Открываем его…
      </p>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_25rem]" aria-hidden>
      <div className="space-y-9">
        {[3, 3, 2].map((n, i) => (
          <div key={i} className="space-y-4">
            <Skeleton className="h-7 w-56" />
            {Array.from({ length: n }, (_, j) => (
              <Skeleton key={j} className="h-14 w-full rounded-2xl" />
            ))}
          </div>
        ))}
      </div>
      <Skeleton className="h-96 rounded-3xl" />
    </div>
  );
}
