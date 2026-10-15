"use client";

import { Building2, ChevronRight, KeyRound, LoaderCircle, LogOut, Mail, MonitorSmartphone, Pencil, Phone, UserRound } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PageHeading } from "@/components/account/account-shell";
import { ACCOUNT_CARD, CARD_HEAD, CardRow, Pill } from "@/components/account/ui";
import { errorMessage } from "@/components/shop/errors";
import { describedBy, Field, FIELD, FormError, phoneError, type FieldErrors } from "@/components/shop/form";
import { ORG_STATUS } from "@/components/shop/labels";
import { ResetPasswordDialog } from "@/components/shop/reset-password";
import { useSession } from "@/components/shop/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** The profile: who the user is, the organizations they work for, and their account's security. Changes open in dialogs. */
export function ProfileView() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeading title="Профиль" lead="Ваши контакты, организации и безопасность входа." />
      <ContactsCard />
      <OrganizationsCard />
      <SecurityCard />
    </div>
  );
}

function initials(name: string | null, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return (words.length ? words.slice(0, 2).map((w) => w[0]) : [email[0]]).join("").toUpperCase();
}

// --- contacts ---------------------------------------------------------------------------------

function ContactsCard() {
  const { user } = useSession();
  const [editing, setEditing] = useState(false);
  if (!user) return null;
  return (
    <Card className={ACCOUNT_CARD}>
      <CardHeader className={CARD_HEAD}>
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-lg font-semibold text-primary">
            {initials(user.name, user.email)}
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate text-lg font-semibold">{user.name || "Без имени"}</CardTitle>
            <CardDescription className="truncate">{user.email}</CardDescription>
          </div>
        </div>
        <CardAction>
          <Button variant="outline" className="gap-2 rounded-xl" onClick={() => setEditing(true)}>
            <Pencil />
            <span className="max-sm:sr-only">Изменить</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <CardRow icon={UserRound} label="Имя">
          {user.name || <span className="font-normal text-muted-foreground">не указано</span>}
        </CardRow>
        <CardRow icon={Phone} label="Телефон">
          {user.phone || <span className="font-normal text-muted-foreground">не указан — менеджеру будет сложнее связаться с вами</span>}
        </CardRow>
        <CardRow icon={Mail} label="E-mail — логин для входа">
          {user.email}
          <span className="block text-xs font-normal text-muted-foreground">Сменить e-mail можно через менеджера</span>
        </CardRow>
      </CardContent>
      <ProfileDialog open={editing} onOpenChange={setEditing} />
    </Card>
  );
}

function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, saveProfile } = useSession();
  const [errors, setErrors] = useState<FieldErrors<"name" | "phone">>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    const found = { name: name.length > 255 ? "Слишком длинное имя" : undefined, phone: phoneError(phone, false) };
    setErrors(found);
    setFormError(null);
    if (found.name || found.phone) return;
    setSaving(true);
    try {
      await saveProfile({ name: name || null, phone: phone || null });
      toast.success("Контакты сохранены");
      onOpenChange(false);
    } catch (err) {
      setFormError(errorMessage(err, "Не удалось сохранить. Попробуйте ещё раз."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setErrors({});
        onOpenChange(o);
      }}
    >
      <DialogContent className="gap-5 p-5 sm:max-w-md sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Контакты</DialogTitle>
          <DialogDescription>Подставляются при оформлении заказа; по телефону менеджер подтверждает заказы.</DialogDescription>
        </DialogHeader>
        <form id="profile-form" noValidate onSubmit={onSubmit} className="space-y-4">
          <Field id="pf-name" label="Имя" error={errors.name}>
            <Input
              name="name"
              autoComplete="name"
              maxLength={255}
              defaultValue={user?.name ?? ""}
              onChange={() => errors.name && setErrors((e) => ({ ...e, name: undefined }))}
              className={FIELD}
              {...describedBy("pf-name", errors.name)}
            />
          </Field>
          <Field id="pf-phone" label="Телефон" error={errors.phone}>
            <Input
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+7 978 123-45-67"
              maxLength={32}
              defaultValue={user?.phone ?? ""}
              onChange={() => errors.phone && setErrors((e) => ({ ...e, phone: undefined }))}
              className={FIELD}
              {...describedBy("pf-phone", errors.phone)}
            />
          </Field>
          {formError && <FormError>{formError}</FormError>}
        </form>
        <DialogFooter className="-mx-5 -mb-5 rounded-b-xl px-5 sm:-mx-6 sm:-mb-6 sm:px-6">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" form="profile-form" disabled={saving}>
            {saving && <LoaderCircle className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- organizations ---------------------------------------------------------------------------

function OrganizationsCard() {
  const { organizations } = useSession();
  return (
    <Card className={ACCOUNT_CARD}>
      <CardHeader className={CARD_HEAD}>
        <CardTitle className="text-base font-semibold">Организации</CardTitle>
        <CardDescription>Компании и ИП, от которых вы работаете</CardDescription>
        <CardAction>
          <Link href="/account/organizations" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Управлять
            <ChevronRight className="size-4" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!organizations?.length ? (
          <p className="py-4 text-sm text-muted-foreground">Организаций пока нет.</p>
        ) : (
          organizations.map((o) => (
            <CardRow
              key={o.id}
              icon={Building2}
              label={`ИНН ${o.inn} · ${o.role === "owner" ? "руководитель" : "закупщик"}`}
              action={<Pill tone={ORG_STATUS[o.status].tone}>{ORG_STATUS[o.status].label}</Pill>}
            >
              {o.name}
            </CardRow>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// --- security --------------------------------------------------------------------------------

function SecurityCard() {
  const { user, logout } = useSession();
  const [dialog, setDialog] = useState<"password" | "everywhere" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leave = (everywhere: boolean) => {
    setLeaving(true);
    logout({ everywhere }).catch((e: unknown) => {
      setLeaving(false);
      toast.error(errorMessage(e, "Не удалось выйти. Попробуйте ещё раз."));
    });
  };
  return (
    <Card className={ACCOUNT_CARD}>
      <CardHeader className={CARD_HEAD}>
        <CardTitle className="text-base font-semibold">Безопасность</CardTitle>
        <CardDescription>Пароль и сеансы входа</CardDescription>
      </CardHeader>
      <CardContent>
        <CardRow
          icon={KeyRound}
          label="Пароль"
          action={
            <Button variant="outline" className="rounded-xl" onClick={() => setDialog("password")}>
              Изменить
            </Button>
          }
        >
          ••••••••
        </CardRow>
        <CardRow
          icon={MonitorSmartphone}
          label="Сеансы"
          action={
            <Button variant="outline" className="rounded-xl" onClick={() => setDialog("everywhere")}>
              <span className="sm:hidden">Выйти везде</span>
              <span className="max-sm:hidden">Выйти на всех устройствах</span>
            </Button>
          }
        >
          <span className="font-normal text-muted-foreground">Если входили с чужого устройства или потеряли телефон</span>
        </CardRow>
        <CardRow
          icon={LogOut}
          label="Этот сеанс"
          action={
            <Button variant="ghost" className="rounded-xl text-muted-foreground" disabled={leaving} onClick={() => leave(false)}>
              {leaving && dialog === null && <LoaderCircle className="animate-spin" />}
              Выйти
            </Button>
          }
        >
          <span className="font-normal text-muted-foreground">Выход только на этом устройстве</span>
        </CardRow>
      </CardContent>
      <ResetPasswordDialog account initialEmail={user?.email ?? ""} open={dialog === "password"} onOpenChange={(o) => setDialog(o ? "password" : null)} />
      <Dialog open={dialog === "everywhere"} onOpenChange={(o) => setDialog(o ? "everywhere" : null)}>
        <DialogContent className="gap-5 p-5 sm:max-w-md sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Выйти на всех устройствах?</DialogTitle>
            <DialogDescription>Сеансы на всех телефонах и компьютерах закончатся, включая этот. Войти снова можно с вашим паролем.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="-mx-5 -mb-5 rounded-b-xl px-5 sm:-mx-6 sm:-mb-6 sm:px-6">
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={leaving}>
              Отмена
            </Button>
            <Button variant="destructive" disabled={leaving} onClick={() => leave(true)}>
              {leaving && <LoaderCircle className="animate-spin" />}
              Выйти везде
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
