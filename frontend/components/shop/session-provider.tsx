"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { errorMessage } from "@/components/shop/errors";
import { api, ApiError } from "@/lib/api/client";
import type { AuthTokens, Cart, CartItem, Organization, OrganizationInput, PaymentMethod, User } from "@/lib/types";

// The visitor's session, organizations and cart, shared by the header, the side panel, product
// cards and the pages. They are per-user data, so they are fetched here, in the browser: catalog
// pages rendered on the server stay the same for everyone and can be cached. The site sells to
// businesses only: prices, the cart and orders are for people of an approved organization.

/** guest: not signed in; pending: no approved organization yet; client: sees prices and orders. */
export type Access = "loading" | "guest" | "pending" | "client";

// Whether the visitor was signed in last time, for the first paint: the root layout's script puts
// it on <html data-auth> before the page shows, so the home page and the side panel of a client do
// not flash the guest's version while the session is being checked.
export const AUTH_HINT_KEY = "it-trade:auth";

// --- remembered payment method ---------------------------------------------------------------
// Cash and cashless prices differ, so the choice is kept between visits. Without localStorage
// (private mode, blocked storage) it lasts until the page is reloaded.

const PAYMENT_KEY = "it-trade:payment";
let paymentChoice: PaymentMethod | null = null;
const paymentListeners = new Set<() => void>();

function getPayment(): PaymentMethod {
  if (paymentChoice === null) {
    try {
      paymentChoice = localStorage.getItem(PAYMENT_KEY) === "cashless" ? "cashless" : "cash";
    } catch {
      paymentChoice = "cash";
    }
  }
  return paymentChoice;
}

function savePayment(p: PaymentMethod): void {
  paymentChoice = p;
  try {
    localStorage.setItem(PAYMENT_KEY, p);
  } catch {
    // not remembered for the next visit
  }
  paymentListeners.forEach((listener) => listener());
}

function subscribePayment(listener: () => void): () => void {
  paymentListeners.add(listener);
  return () => {
    paymentListeners.delete(listener);
  };
}

// the server and the hydration render use the default; the remembered choice applies right after
const serverPayment = (): PaymentMethod => "cash";

// --- contexts --------------------------------------------------------------------------------

export type RegisterData = { email: string; code: string; password: string; name: string | null; phone: string | null; organization: OrganizationInput };
export type CartLineInput = { sku: number; qty: number };

type SessionValue = {
  user: User | null;
  /** until the first answer of /api/auth/me */
  loading: boolean;
  /** the API said there is no session (401); not when it could not be reached */
  signedOut: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  /** Ends this session (or all of them) and reloads the page. */
  logout: (options?: { everywhere?: boolean }) => Promise<void>;
  saveProfile: (data: { name: string | null; phone: string | null }) => Promise<User>;
  /** a new password confirmed with the code sent to the user's e-mail (POST /api/auth/password/code) */
  changePassword: (code: string, next: string) => Promise<void>;
  /** Call before a request made on the user's behalf; false if the session turned out to be over. */
  keepSession: () => Promise<boolean>;
  /** the user's organizations; null for a guest and until loaded */
  organizations: Organization[] | null;
  refreshOrganizations: () => Promise<void>;
  access: Access;
};

type CartValue = {
  cart: Cart | null;
  /** until the first answer */
  loading: boolean;
  /** the cart could not be loaded */
  error: boolean;
  /** changes are being saved: totals are about to change */
  syncing: boolean;
  payment: PaymentMethod;
  setPayment: (payment: PaymentMethod) => void;
  /** the line of a product, if it is in the cart */
  line: (sku: number) => CartItem | undefined;
  /** quantity on screen: the one being saved, else the cart's; 0 = not in the cart or being removed */
  qty: (sku: number) => number;
  add: (items: CartLineInput[]) => Promise<Cart>;
  setQty: (sku: number, qty: number) => void;
  remove: (sku: number) => void;
  clear: () => Promise<Cart>;
  /** Which of the user's approved organizations the cart (and every price on the site) is for. */
  setBuyer: (organizationId: number) => Promise<Cart>;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);
const CartContext = createContext<CartValue | null>(null);

export function useSession(): SessionValue {
  const ctx = use(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

export function useCart(): CartValue {
  const ctx = use(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <SessionProvider>");
  return ctx;
}

// pages a signed-out visitor cannot stay on
const PRIVATE_PATH = /^\/(account|cart|checkout)(\/|$)/;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  // loaded for this user: after a sign-out or another sign-in they no longer apply
  const [orgs, setOrgs] = useState<{ userId: number; list: Organization[] } | null>(null);
  const organizations = orgs && orgs.userId === user?.id ? orgs.list : null;
  const userRef = useRef<User | null>(null);
  const tokenUntil = useRef(0); // when the access cookie expires (ms), 0 = unknown
  const refreshing = useRef<Promise<boolean> | null>(null);

  const [cart, setCart] = useState<Cart | null>(null);
  const [cartLoading, setCartLoading] = useState(true);
  const [cartError, setCartError] = useState(false);
  const [busy, setBusy] = useState(0); // cart changes queued or in flight
  const [pending, setPending] = useState<ReadonlyMap<number, number>>(() => new Map());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const wishes = useRef(new Map<number, number>()); // sku -> quantity asked for and not saved yet
  const scheduled = useRef(new Set<number>()); // skus whose request waits in the queue
  const payment = useSyncExternalStore(subscribePayment, getPayment, serverPayment);

  // --- session -------------------------------------------------------------------------------

  // null only ever comes from a 401: the session is over
  const setUser = useCallback((u: User | null) => {
    userRef.current = u;
    setUserState(u);
    setSignedOut(u === null);
  }, []);

  /** Fresh tokens: the access cookie lives `expires_in` from now (less a margin for the trip). */
  const signedIn = useCallback(
    (t: AuthTokens) => {
      tokenUntil.current = Date.now() + Math.max(0, t.expires_in - 30) * 1000;
      setUser(t.user);
    },
    [setUser],
  );

  // The access cookie lives 15 minutes, and the cart and checkout API serve a request without it
  // as a guest's: a signed-in user with a page open for a while would silently get the guest
  // cart, or place a guest order. So before such requests the session is refreshed when the
  // token's expiry is unknown (after a page load) or near; the refresh tells the new expiry.
  const keepSession = useCallback((): Promise<boolean> => {
    if (!userRef.current || Date.now() < tokenUntil.current) return Promise.resolve(true);
    refreshing.current ??= api<AuthTokens>("/api/auth/refresh", { method: "POST" })
      .then(
        (t) => {
          signedIn(t);
          return true;
        },
        (e: unknown) => {
          if (!(e instanceof ApiError && e.status === 401)) return true; // no connection: the request will tell
          // signed out elsewhere (another device, a password change): from now on a guest
          tokenUntil.current = 0;
          setUser(null);
          toast.info("Сеанс завершён. Войдите снова, чтобы вернуться к своей корзине и заказам.");
          return false;
        },
      )
      .finally(() => {
        refreshing.current = null;
      });
    return refreshing.current;
  }, [signedIn, setUser]);

  const refreshSession = useCallback(async () => {
    await keepSession();
    try {
      setUser(await api<User>("/api/auth/me"));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
      tokenUntil.current = 0;
      setUser(null);
    }
  }, [keepSession, setUser]);

  // --- cart ----------------------------------------------------------------------------------

  /** Cart requests go one at a time, so each response is the cart after all the earlier changes. */
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  /** A cart request for the chosen payment method; its response becomes the cart. */
  const send = useCallback(
    async (path: string, init?: RequestInit): Promise<Cart> => {
      await keepSession();
      const next = await api<Cart>(`${path}?payment=${getPayment()}`, init);
      setCart(next);
      setCartError(false);
      setCartLoading(false);
      return next;
    },
    [keepSession],
  );

  /** A change of the cart: `syncing` until it (and whatever was queued before it) is done. */
  const mutate = useCallback(
    <T,>(task: () => Promise<T>): Promise<T> => {
      setBusy((n) => n + 1);
      return enqueue(task).finally(() => setBusy((n) => n - 1));
    },
    [enqueue],
  );

  const load = useCallback(
    () =>
      enqueue(() => send("/api/cart")).then(
        () => undefined,
        (e: unknown) => {
          setCartError(true);
          setCartLoading(false);
          throw e;
        },
      ),
    [enqueue, send],
  );

  const add = useCallback(
    (items: CartLineInput[]) => mutate(() => send("/api/cart/items", { method: "POST", body: JSON.stringify({ items }) })),
    [mutate, send],
  );

  // Quantity changes of a line coalesce: a click while the line's request is waiting only updates
  // what that request will send, so fast +/- clicks make at most one request in flight and one
  // queued, and the screen shows the last quantity asked for until the server confirms it.
  const setQty = useCallback(
    (sku: number, qty: number) => {
      wishes.current.set(sku, qty);
      setPending(new Map(wishes.current));
      if (scheduled.current.has(sku)) return;
      scheduled.current.add(sku);
      void mutate(async () => {
        scheduled.current.delete(sku);
        const want = wishes.current.get(sku);
        if (want === undefined) return; // dropped by clear()
        try {
          await send(`/api/cart/items/${sku}`, want > 0 ? { method: "PUT", body: JSON.stringify({ qty: want }) } : { method: "DELETE" });
        } catch (e) {
          toast.error(errorMessage(e, want > 0 ? "Не удалось изменить количество" : "Не удалось удалить товар"));
          // the product may have become unavailable meanwhile: show the cart as it is now
          void enqueue(() => send("/api/cart")).catch(() => undefined);
        } finally {
          if (!scheduled.current.has(sku)) wishes.current.delete(sku); // else a newer quantity is on its way
          setPending(new Map(wishes.current));
        }
      });
    },
    [enqueue, mutate, send],
  );

  const remove = useCallback((sku: number) => setQty(sku, 0), [setQty]);

  const setBuyer = useCallback(
    (organizationId: number) =>
      mutate(() => send("/api/cart/organization", { method: "PUT", body: JSON.stringify({ organization_id: organizationId }) })),
    [mutate, send],
  );

  const clear = useCallback(
    () =>
      mutate(() => {
        wishes.current.clear();
        setPending(new Map());
        return send("/api/cart", { method: "DELETE" });
      }),
    [mutate, send],
  );

  const setPayment = useCallback(
    (p: PaymentMethod) => {
      if (p === getPayment()) return;
      savePayment(p);
      // lines without a price for this payment method become problems: the cart is re-read
      void mutate(() => send("/api/cart")).catch((e: unknown) => toast.error(errorMessage(e, "Не удалось пересчитать корзину")));
    },
    [mutate, send],
  );

  // --- account actions -----------------------------------------------------------------------

  const enter = useCallback(
    async (path: string, body: object): Promise<User> => {
      const t = await api<AuthTokens>(path, { method: "POST", body: JSON.stringify(body) });
      // the organizations, and then the cart, load once the user is known (effects below)
      signedIn(t);
      return t.user;
    },
    [signedIn],
  );

  const login = useCallback((email: string, password: string) => enter("/api/auth/login", { email, password }), [enter]);
  const register = useCallback((data: RegisterData) => enter("/api/auth/register", data), [enter]);

  const logout = useCallback(
    async ({ everywhere = false }: { everywhere?: boolean } = {}) => {
      if (!everywhere) await api("/api/auth/logout", { method: "POST" });
      // ending all sessions needs a live one; if it is already over, there is nothing left to end
      else if (await keepSession()) await api("/api/auth/logout-all", { method: "POST" });
      // A full page load drops what the open pages keep in memory (forms, this account's orders,
      // pages kept alive for back navigation); private pages send the visitor home.
      if (PRIVATE_PATH.test(window.location.pathname)) window.location.replace("/");
      else window.location.reload();
    },
    [keepSession],
  );

  const saveProfile = useCallback(
    async (data: { name: string | null; phone: string | null }) => {
      await keepSession();
      const u = await api<User>("/api/auth/me", { method: "PATCH", body: JSON.stringify(data) });
      setUser(u);
      return u;
    },
    [keepSession, setUser],
  );

  const changePassword = useCallback(
    async (code: string, next: string) => {
      await keepSession();
      // other sessions end; this one gets new tokens
      signedIn(
        await api<AuthTokens>("/api/auth/password", {
          method: "POST",
          body: JSON.stringify({ code, new_password: next }),
        }),
      );
    },
    [keepSession, signedIn],
  );

  const refreshOrganizations = useCallback(async () => {
    const userId = userRef.current?.id;
    if (userId === undefined || !(await keepSession())) return;
    const list = await api<Organization[]>("/api/account/organizations");
    setOrgs({ userId, list });
  }, [keepSession]);

  // --- loading -------------------------------------------------------------------------------

  // the organizations of whoever is signed in now (none for a guest)
  const userId = user?.id;
  useEffect(() => {
    if (userId !== undefined) refreshOrganizations().catch(() => undefined);
  }, [userId, refreshOrganizations]);

  const canBuy = !!organizations?.some((o) => o.status === "approved");
  const access: Access = sessionLoading ? "loading" : !user ? "guest" : organizations === null ? "loading" : canBuy ? "client" : "pending";
  const canBuyRef = useRef(false);
  useEffect(() => {
    canBuyRef.current = canBuy;
    if (canBuy) load().catch(() => undefined);
  }, [canBuy, load]);

  useEffect(() => {
    let alive = true;
    api<User>("/api/auth/me")
      .then(
        (u) => alive && setUser(u),
        (e: unknown) => alive && e instanceof ApiError && e.status === 401 && setSignedOut(true), // a guest
      )
      .finally(() => alive && setSessionLoading(false));
    return () => {
      alive = false;
    };
  }, [setUser]);

  // the hint for the next first paint (see AUTH_HINT_KEY), and the page's own look now
  useEffect(() => {
    if (sessionLoading) return;
    const v = user ? "user" : "guest";
    document.documentElement.dataset.auth = v;
    try {
      localStorage.setItem(AUTH_HINT_KEY, v);
    } catch {
      // the hint is only a nicety
    }
  }, [sessionLoading, user]);

  // Another tab may have changed the cart or the session: re-read both when the visitor comes back.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 30_000) {
        refreshSession()
          .catch(() => undefined)
          .then(() => refreshOrganizations())
          .catch(() => undefined)
          .then(() => (canBuyRef.current ? load() : undefined))
          .catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [load, refreshSession, refreshOrganizations]);

  // --- context values ------------------------------------------------------------------------

  const bySku = useMemo(() => new Map((cart?.items ?? []).map((i) => [i.sku, i])), [cart]);
  const line = useCallback((sku: number) => bySku.get(sku), [bySku]);
  const qty = useCallback((sku: number) => pending.get(sku) ?? bySku.get(sku)?.qty ?? 0, [pending, bySku]);

  const session = useMemo<SessionValue>(
    () => ({
      user,
      loading: sessionLoading,
      signedOut,
      refresh: refreshSession,
      login,
      register,
      logout,
      saveProfile,
      changePassword,
      keepSession,
      organizations,
      refreshOrganizations,
      access,
    }),
    [user, sessionLoading, signedOut, refreshSession, login, register, logout, saveProfile, changePassword, keepSession, organizations, refreshOrganizations, access],
  );

  const cartValue = useMemo<CartValue>(
    () => ({
      // only a client has a cart; until the organizations are known it is still loading
      cart: canBuy ? cart : null,
      loading: access === "loading" || (canBuy && cartLoading),
      error: cartError,
      syncing: busy > 0 || pending.size > 0,
      payment,
      setPayment,
      line,
      qty,
      add,
      setQty,
      remove,
      clear,
      setBuyer,
      refresh: load,
    }),
    [cart, canBuy, access, cartLoading, cartError, busy, pending, payment, setPayment, line, qty, add, setQty, remove, clear, setBuyer, load],
  );

  return (
    <SessionContext value={session}>
      <CartContext value={cartValue}>{children}</CartContext>
    </SessionContext>
  );
}
