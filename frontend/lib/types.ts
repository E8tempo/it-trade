// Shapes of the FastAPI catalog API (backend/app/api/schemas.py).

export type ImageUrls = { lg: string; md: string };

export type ProductImage = {
  id: number;
  width: number | null;
  height: number | null;
  urls: ImageUrls;
};

export type CategoryRef = { id: number; name: string; slug: string };

export type CategoryNode = CategoryRef & {
  product_count: number;
  children: CategoryNode[];
};

export type CategoryDetail = CategoryRef & {
  product_count: number;
  breadcrumbs: CategoryRef[];
  children: CategoryNode[];
};

export type ProductCard = {
  sku: number;
  name: string;
  slug: string;
  vendor: string | null;
  part: string | null;
  // no prices: the site sells to businesses only, a client's browser takes them from /api/cart/prices
  in_stock: boolean;
  qty: number;
  image: ProductImage | null;
};

export type VendorFacet = { name: string; count: number };

export type ProductPage = {
  items: ProductCard[];
  total: number;
  page: number;
  per_page: number;
  vendors: VendorFacet[];
};

export type ProductDetail = ProductCard & {
  description: string | null;
  barcodes: string[];
  weight: number | null;
  volume: number | null;
  warranty_months: number | null;
  multiplicity: number;
  delivery_days: number | null;
  category: CategoryRef | null;
  breadcrumbs: CategoryRef[];
  images: ProductImage[];
};

export type Shop = {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  working_hours: string;
  show_out_of_stock: boolean;
};

export type SortKey = "popular" | "price_asc" | "price_desc" | "new" | "name";

/** Listing query, as used in URLs (?vendor=..&min=..&max=..&sort=..&page=..) and passed to the API. */
export type ListingQuery = {
  q?: string;
  category?: number;
  vendors: string[];
  sort: SortKey;
  page: number;
};

// --- customers: accounts, cart, orders (backend/app/api/auth.py, cart.py, orders.py) ---------

export type Audience = "retail" | "wholesale";
export type PaymentMethod = "cash" | "cashless";
export type PriceType = `${Audience}_${PaymentMethod}`;
export type DeliveryMethod = "pickup" | "courier" | "transport";
export type OrderStatus = "new" | "confirmed" | "ordered" | "ready" | "shipped" | "completed" | "cancelled";

export type User = { id: number; email: string; name: string | null; phone: string | null; role: string };

/** Response of login, register, refresh and password change; the tokens are also set as httpOnly cookies. */
export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  /** lifetime of the access token, seconds */
  expires_in: number;
  user: User;
};

/** Why a line cannot be ordered: the product left the catalog, ran out or has no price. */
export type CartProblem = "not_found" | "out_of_stock" | "no_price";

export type CartItem = {
  sku: number;
  name: string;
  slug: string;
  vendor: string | null;
  part: string | null;
  image: ProductImage | null;
  qty: number;
  multiplicity: number;
  stock: number;
  in_stock: boolean;
  /** unit price of the cart's price type */
  price: number | null;
  /** unit prices of this customer's audience for both payment methods */
  prices: Record<PaymentMethod, number | null>;
  total: number | null;
  problem: CartProblem | null;
};

/** The organization a cart is priced for (wholesale prices). */
export type CartBuyer = { id: number; name: string; inn: string };

export type Cart = {
  audience: Audience;
  /** the organization the cart (and every price on the site) is for */
  organization: CartBuyer;
  payment: PaymentMethod;
  price_type: PriceType;
  items: CartItem[];
  lines: number;
  units: number;
  /** lines without a problem, for the chosen payment */
  total: number;
  totals: Record<PaymentMethod, number>;
  can_checkout: boolean;
  /** filled by POST /api/cart/items only */
  not_added: { sku: number; reason: CartProblem }[];
};

export type CheckoutIn = {
  customer_name: string;
  phone: string;
  email: string | null;
  delivery: DeliveryMethod;
  city: string | null;
  address: string | null;
  comment: string | null;
  payment_method: PaymentMethod;
  /** buying for an organization (the cart's buyer): one of its active contracts */
  contract_id: number | null;
  /** the total the customer saw: the order is refused (409) if prices changed meanwhile */
  expected_total: number | null;
};

export type CustomerOrderListItem = {
  id: number;
  number: string;
  status: OrderStatus;
  created_at: string;
  total: number;
  items_count: number;
  payment_method: PaymentMethod;
  /** the organization it was bought for */
  buyer_name: string | null;
};

/** The account's tabs of orders: in progress, completed, cancelled. */
export type OrderState = "open" | "completed" | "cancelled";

export type CustomerOrderPage = {
  items: CustomerOrderListItem[];
  total: number;
  page: number;
  per_page: number;
  /** all the orders the user sees, per state */
  counts: Record<OrderState, number>;
};

export type CustomerOrderItem = {
  sku: number;
  name: string;
  /** product page, if the product is still in the catalog */
  slug: string | null;
  image: ProductImage | null;
  price: number;
  qty: number;
  total: number;
};

export type CustomerOrder = {
  id: number;
  number: string;
  status: OrderStatus;
  created_at: string;
  customer_name: string;
  phone: string;
  email: string | null;
  delivery: DeliveryMethod;
  city: string | null;
  address: string | null;
  comment: string | null;
  payment_method: PaymentMethod;
  buyer: OrderBuyer | null;
  items_total: number;
  delivery_price: number;
  discount: number;
  total: number;
  items: CustomerOrderItem[];
  /** status changes */
  history: { at: string; status: OrderStatus }[];
};

/** Prices of catalog products for the cart's buyer (GET /api/cart/prices): keyed by sku. */
export type BuyerPrices = { audience: Audience; prices: Record<string, Record<PaymentMethod, number | null>> };

// --- organizations a customer buys for (backend/app/api/account.py) ----------------------------

export type OrganizationStatus = "pending" | "approved" | "rejected";
/** owner: the head (requisites, people, every order); buyer: a purchaser (catalog, cart, own orders) */
export type MemberRole = "owner" | "buyer";
export type ContractTerms = "prepayment" | "deferred";

export type ContractRef = {
  id: number;
  number: string;
  /** date, YYYY-MM-DD */
  signed_on: string;
  terms: ContractTerms;
  deferral_days: number | null;
};

/** A contract with the shop, entered by a manager. */
export type Contract = ContractRef & { is_active: boolean };

export type OrganizationInput = { name: string; inn: string; kpp: string | null; ogrn: string | null; address: string | null };

export type Organization = OrganizationInput & {
  id: number;
  status: OrganizationStatus;
  /** the user's role in it */
  role: MemberRole;
  /** why a manager rejected it */
  review_note: string | null;
  created_at: string;
  contracts: Contract[];
};

/** The organization an order was placed for and its contract, as they were at checkout. */
export type OrderBuyer = OrganizationInput & { contract: ContractRef | null };

// --- news and promotions on the home page (backend/app/api/posts.py) ---------------------------

export type PostKind = "news" | "promo";

export type Post = {
  id: number;
  kind: PostKind;
  title: string;
  /** plain text, paragraphs split by blank lines */
  body: string;
  /** «Подробнее»: a page of the site (/catalog/...) or another site */
  link_url: string | null;
  published_at: string | null;
  pinned: boolean;
  /** a promotion's last day, YYYY-MM-DD */
  ends_on: string | null;
};

// --- commercial offers a client makes for their customers (backend/app/api/quotes.py) ----------

/** What a client's offers print besides the organization's requisites, and the defaults of a new offer. */
export type QuoteProfile = {
  phone: string | null;
  email: string | null;
  website: string | null;
  bank_name: string | null;
  bik: string | null;
  account: string | null;
  corr_account: string | null;
  signer_title: string | null;
  signer_name: string | null;
  markup_percent: number;
  vat_rate: number | null;
  /** a new offer is valid for so many days */
  valid_days: number | null;
  terms: string | null;
};

export type QuoteProfileOut = QuoteProfile & { can_edit: boolean };

export type QuoteSeller = OrganizationInput & {
  profile: QuoteProfile;
  author_name: string | null;
  author_email: string | null;
  author_phone: string | null;
};

/** fixed: typed in; rrp: the supplier's RRP; markup: the client's markup over what they pay us */
export type PriceSource = "fixed" | "rrp" | "markup";

export type QuoteLine = {
  id: number;
  /** null: the client's own line (installation, delivery) */
  sku: number | null;
  name: string;
  vendor: string | null;
  part: string | null;
  unit: string;
  qty: number;
  slug: string | null;
  image: ProductImage | null;
  /** what the client pays us per unit, as when the line was added or the prices refreshed */
  cost: number | null;
  rrp: number | null;
  /** the line's own markup; null: the offer's */
  markup_percent: number | null;
  /** a selling price typed in */
  price: number | null;
  sale_price: number | null;
  price_source: PriceSource | null;
  total: number | null;
  profit: number | null;
  /** what the client would pay us now */
  current_cost: number | null;
  stock: number;
  problem: CartProblem | null;
};

export type QuoteTotals = {
  total: number;
  cost: number;
  profit: number;
  vat: number | null;
  units: number;
  unpriced: number;
  changed: number;
  problems: number;
};

export type Quote = {
  id: number;
  number: number;
  organization_id: number;
  title: string | null;
  customer: string | null;
  customer_contact: string | null;
  payment: PaymentMethod;
  markup_percent: number;
  use_rrp: boolean;
  /** selling prices are rounded up to: 0 kopecks, 1 rouble, 10, 100 */
  round_to: number;
  vat_rate: number | null;
  /** YYYY-MM-DD */
  valid_until: string | null;
  terms: string | null;
  show_photos: boolean;
  created_at: string;
  updated_at: string;
  seller: QuoteSeller;
  items: QuoteLine[];
  totals: QuoteTotals;
};

export type QuoteListItem = {
  id: number;
  number: number;
  title: string | null;
  customer: string | null;
  organization_name: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  lines: number;
  total: number;
};

export type QuotePage = { items: QuoteListItem[]; total: number; page: number; per_page: number };
