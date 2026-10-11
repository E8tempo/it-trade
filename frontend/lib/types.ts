// Shapes of the FastAPI catalog API (backend/app/api/schemas.py).

export type ImageUrls = { lg: string; md: string; sm: string };

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
  price: number | null;
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
  price_min: number | null;
  price_max: number | null;
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
  min?: number;
  max?: number;
  sort: SortKey;
  page: number;
};
