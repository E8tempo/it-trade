// Shapes of the admin API (backend/app/api/admin/*).

export type Page<T> = { items: T[]; total: number; page: number; per_page: number };

export type AdminUser = { id: number; email: string; name: string | null; role: string };

export type OrderStatus = "new" | "confirmed" | "ordered" | "ready" | "shipped" | "completed" | "cancelled";
export type OrderSource = "site" | "phone" | "admin";
export type DeliveryMethod = "pickup" | "courier" | "transport";

export type OrderListItem = {
  id: number;
  number: string;
  status: OrderStatus;
  source: OrderSource;
  customer_name: string;
  phone: string;
  total: number;
  items_count: number;
  created_at: string;
};

export type OrderItem = {
  id: number;
  sku: number;
  name: string;
  price: number;
  supplier_price: number | null;
  qty: number;
  total: number;
  slug: string | null;
};

export type OrderEvent = { id: number; at: string; status: OrderStatus | null; note: string | null; author: string | null };

export type Order = OrderListItem & {
  email: string | null;
  delivery: DeliveryMethod;
  city: string | null;
  address: string | null;
  comment: string | null;
  manager_note: string | null;
  items_total: number;
  delivery_price: number;
  discount: number;
  cost_total: number;
  margin: number;
  updated_at: string;
  items: OrderItem[];
  events: OrderEvent[];
};

export type OrderPage = Page<OrderListItem> & { counts: Partial<Record<OrderStatus, number>> };

export type CategoryRef = { id: number; name: string; slug: string };

export type AdminProduct = {
  sku: number;
  name: string;
  slug: string;
  vendor: string | null;
  part: string | null;
  category: CategoryRef | null;
  supplier_price: number | null;
  rrp: number | null;
  price: number | null;
  price_override: number | null;
  markup_percent: number | null;
  in_stock: boolean;
  qty: number;
  is_hidden: boolean;
  is_active: boolean;
  image: string | null;
};

// Decimal fields of the settings come as strings from the API; the forms send numbers back.
type Num = number | string;

export type PricingSettings = {
  markup_percent: Num;
  category_markups: Record<string, Num>;
  min_markup: Num;
  round_to: number;
  use_rrp: boolean;
};

export type ShopSettings = {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  working_hours: string;
  show_out_of_stock: boolean;
  gallery_min_side: number;
  gallery_dedupe: boolean;
};

export type AdminCategory = {
  id: number;
  parent_id: number | null;
  name: string;
  depth: number;
  product_count: number;
  is_hidden: boolean;
  markup: number | null;
};

export type PricePreview = {
  markup_percent: number;
  markup_category: CategoryRef | null;
  by_markup: number;
  floor: number;
  rrp_used: boolean;
  before_rounding: number;
  price: number;
  margin: number;
  margin_percent: number;
  category_path: CategoryRef[];
};

export type PriceImpact = {
  products: number;
  changed: number;
  up: number;
  down: number;
  avg_markup_before: number;
  avg_markup_after: number;
  examples: { sku: number; name: string; supplier_price: number; before: number | null; after: number }[];
};

export type Job = {
  name: string;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  info: Record<string, unknown>;
};

export type Dashboard = {
  products: { active: number; in_stock: number; hidden: number; fixed_price: number; in_stock_without_price: number };
  images: { by_status: Record<string, number>; by_variant: Record<string, number> };
  orders: {
    by_status: Partial<Record<OrderStatus, number>>;
    open: number;
    completed_30d: number;
    revenue_30d: number;
    margin_30d: number;
  };
  recent_orders: OrderListItem[];
  jobs: Job[];
};

export type LabDetection = {
  template: string;
  rotated: boolean;
  x: number;
  y: number;
  score: number;
  strength: number;
  layers: number;
  opacity: number;
  color: number | null;
};

export type LabResult = {
  width: number;
  height: number;
  format: string;
  chroma_subsampling: string;
  candidates: (LabDetection & { clipped: number; verdict: string | null })[];
  detection:
    | (LabDetection & {
        verdict: string;
        moved: [number, number] | null;
        box: [number, number, number, number];
        template_size: [number, number];
        left: number; // mark left after the removal, luma levels per unit of alpha
        left_before: number;
      })
    | null;
  plain?: { share: number; max: number };
  fit?: {
    pixels: number;
    grey: number;
    candidates: {
      layers: number;
      shared: boolean;
      opacity: number;
      colours: number[];
      left: number;
      plausible: boolean;
      chosen: boolean;
    }[];
  };
  timings_ms: { detect: number; remove?: number };
  images: Partial<Record<"original" | "cleaned" | "crop_before" | "crop_after" | "mask" | "diff", string>>;
};

export type LabSample = { image_id: number; sku: number; name: string; variant: string; thumb: string };

export type FailedImage = { id: number; sku: number; source_url: string; error: string | null; attempts: number };
