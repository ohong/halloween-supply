// Shared catalog types. Every module (catalog, pipeline, storefront, assistant,
// checkout) builds against these. Change them only through the lead.

/** Prices are always integer US cents. */
export type Cents = number;
/** Relative price within one piece's three merchant options. */
export type PriceTier = "$" | "$$" | "$$$";

export type CostumeStatus = "live" | "coming_soon";

export interface Costume {
  slug: string;
  name: string;
  description: string;
  /** Tile image under /public, e.g. "/costumes/cosmic-cowboy.png". */
  image: string;
  alt: string;
  status: CostumeStatus;
}

/** What the assistant needs to ask for before checkout. */
export type SizeKind = "apparel" | "pants" | "shoe" | "hat" | "one_size";

export interface Piece {
  /** Stable across costumes, e.g. "cowboy-hat". Pieces are shared between costumes. */
  id: string;
  name: string;
  category: string;
  required: boolean;
  /** Display order within the costume (ascending). */
  order: number;
  styleNotes: string;
  queries: string[];
  sizeKind: SizeKind;
}

export interface Region {
  name: string; // "Bay Area"
}

export interface Neighborhood {
  /** e.g. "sf-mission" */
  id: string;
  name: string; // "Mission District"
  city: string; // "San Francisco"
  /** Region name, e.g. "Bay Area", or null when outside any tracked region. */
  region: string | null;
}

export type MerchantKind = "etsy" | "vintage" | "secondhand" | "pawn" | "dtc" | "boutique";

export interface Merchant {
  /** e.g. "etsy-desertsonvintage" or a domain slug "bootbarn-sf". */
  id: string;
  name: string;
  /** Registrable domain used for blocklist checks, e.g. "etsy.com". */
  domain: string;
  /** Merchant home or shop page. */
  url: string;
  kind: MerchantKind;
  /** Neighborhood id, or null when unknown / not local. */
  neighborhoodId: string | null;
}

export interface Tag {
  /** e.g. "vintage", "handmade", "local", "secondhand", "western-wear", "felt". */
  slug: string;
  label: string;
}

export type Availability = "in_stock" | "out_of_stock" | "unknown";

export interface Product {
  id: string;
  title: string;
  /** Live product page at the merchant. */
  url: string;
  priceCents: Cents;
  currency: "USD";
  /** Primary display image: a path under /public/products/ when processed, else a remote URL. */
  image: string;
  /** Reviewed transparent product silhouette used by the selectable flat-lay. */
  cutout?: string;
  /** Local copy of the actual merchant photograph, distinct from generated cutouts. */
  merchantImage?: string;
  /** Remote source images as found on the merchant page. */
  sourceImages: string[];
  availability: Availability;
  /** Sizes offered by the merchant, as printed on the page. Empty = one size / unknown. */
  sizes: string[];
  merchantId: string;
  tagSlugs: string[];
  /** Short factual description from the merchant page (materials etc.). */
  description: string;
  /** ISO timestamp of the last time price/stock was confirmed. */
  checkedAt: string;
  /** Original research evidence, retained when routine price checks update checkedAt. */
  sourcing?: { method: "built-in-web"; checkedAt: string; url: string; notes: string };
}

/** One piece-to-product match. Rank 0 is the default pick. */
export interface Match {
  productId: string;
  rank: number;
  reason: string;
}

export interface SnapshotPiece extends Piece {
  /** Exactly three: the default (rank 0) and two alternatives. */
  matches: Match[];
}

/** One hop in a "why this pick" explanation; every claim maps to a node or edge. */
export interface PickPathStep {
  kind: "piece" | "product" | "tag" | "merchant" | "neighborhood" | "region" | "price";
  label: string;
}

/** The catalog evidence behind "why this pick". */
export interface PickReason {
  productId: string;
  pieceId: string;
  rank: number;
  /** The ranker's written reason for the match. */
  reason: string;
  path: PickPathStep[];
  /** True when the merchant is in the Bay Area region (support-local badge). */
  isLocal: boolean;
  /** True when this is the cheapest of the piece's matches. */
  isCheapest: boolean;
  priceTier: PriceTier;
}

/** Everything about one costume, as written by the pipeline and loaded by the seed. */
export interface CostumeSnapshot {
  costume: Costume;
  pieces: SnapshotPiece[];
  products: Product[];
  merchants: Merchant[];
  neighborhoods: Neighborhood[];
  tags: Tag[];
  /** How this snapshot was produced, for honesty in the UI and reports. */
  provenance: {
    method: "pipeline" | "manual-research";
    generatedAt: string;
    notes?: string;
    priceTiers?: boolean;
    heroImageKind?: "generated-reference";
  };
}

/** A product joined with what the UI needs to render it. */
export interface ProductOption {
  product: Product;
  merchant: Merchant;
  neighborhood: Neighborhood | null;
  tags: Tag[];
  pick: PickReason;
}

/** One row of the costume page: a piece with its default and two alternatives (rank order). */
export interface PieceView {
  piece: Piece;
  options: ProductOption[];
}

export interface CostumeView {
  costume: Costume;
  pieces: PieceView[];
}

/** A merchant that carries more than one of the given products. */
export interface SharedMerchant {
  merchant: Merchant;
  productIds: string[];
}

/** Filters shared by the catalog, snapshot, and assistant catalog queries. */
export interface AlternativeFilters {
  localOnly?: boolean;
  /** Inclusive limit in integer US cents. */
  maxPriceCents?: Cents;
  costumeSlug?: string;
}

/** Server catalog contract. Implementations return checked merchant products only. */
export interface Catalog {
  getCostume(slug: string): Promise<CostumeView | null>;
  getAlternatives(pieceId: string, filters?: AlternativeFilters): Promise<ProductOption[]>;
  getMerchantCatalog(merchantId: string, costumeSlug: string): Promise<ProductOption[]>;
  getFewestShops(productIds: string[]): Promise<SharedMerchant[]>;
  getPickPath(productId: string, pieceId: string): Promise<PickReason | null>;
  getProductOption(productId: string, pieceId: string): Promise<ProductOption | null>;
}

export interface CartItem {
  /** One cart line per piece; adding another product for the same piece replaces it. */
  pieceId: string;
  pieceName: string;
  sizeKind: SizeKind;
  productId: string;
  title: string;
  productUrl: string;
  image: string;
  merchantId: string;
  merchantName: string;
  priceCents: Cents;
  /** Current merchant labels for this product. Empty means no sized choice is confirmed. */
  availableSizes: string[];
  /** Set by the assistant's recordSizes tool. null = not given yet. */
  size: string | null;
}
