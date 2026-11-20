export type Scope = "pump" | "mixer";
export type DictKind = "customer" | "truck_model";

export interface RecordInput {
  scope: Scope;
  entry_date: string;
  truck_model: string;
  customer_name: string;
  volume: number;
  remark: string;
  amount_override: number | null;
}

export interface LedgerRecord extends RecordInput {
  id: number;
}

export interface RecordFilters {
  scope?: Scope | "all";
  from?: string;
  to?: string;
  customer?: string;
  model?: string;
  q?: string;
  limit?: number;
}

export interface DecoratedRecord extends LedgerRecord {
  scope_label: string;
  amount: number;
  amount_formula_value: number;
  amount_source: "formula" | "manual";
  unit_price: number;
  price_missing: boolean;
  amount_error: string;
}

export type RecordField = Exclude<keyof RecordInput, "scope" | "amount_override">;

export interface ScopeDefinition {
  key: Scope;
  label: string;
  tableName: string;
  fields: ScopeField[];
}

export type ScopeField = {
  label: string;
  required: boolean;
  placeholder?: string;
  hint?: string;
} & (
  | { key: "entry_date"; type: "date" }
  | { key: "truck_model" | "customer_name"; type: "dict"; dict: DictKind }
  | { key: "volume"; type: "number" }
  | { key: "remark"; type: "text" }
);

export interface DictInput {
  kind: DictKind;
  scope?: string;
  label: string;
  sort_order?: number;
}

export interface DictOption {
  id: number;
  scope: string;
  label: string;
  sort_order: number;
}

export interface DictItem extends DictOption {
  kind: DictKind;
  active: number | boolean;
}

export type DictPatch = Partial<Pick<DictItem, "label" | "sort_order" | "active">>;

export interface UnitPrice {
  id: number;
  scope: Scope;
  customer_name: string;
  truck_model: string;
  price: number;
  note: string;
}

type PriceFields = Partial<Omit<UnitPrice, "id" | "scope">>;
export type PriceInput = PriceFields & ({ id?: undefined; scope: Scope } | { id: number; scope?: Scope });

export interface PriceMatch {
  price: number;
  missing: boolean;
  source?: string;
}

export type PriceLookup = (customer: string, model: string) => PriceMatch;

export interface FormulaSettings {
  volume_formula: string;
  amount_formula: string;
  amount_decimals: number;
}

export type FormulaInput = Omit<FormulaSettings, "amount_decimals"> & { scope: Scope; amount_decimals?: number };
export type Formulas = Record<Scope, FormulaSettings>;
export type FormulaValue = number | string | boolean | null | undefined;
export type FormulaValues = Record<string, FormulaValue>;

export interface OcrEntry {
  table: Scope;
  customer: string;
  truck_model: string;
  volume: number;
  note: string;
  raw: string;
  confidence: number | null;
  uncertain: string[];
}

export interface OcrResult {
  date: string;
  entries: OcrEntry[];
}

export interface SessionData {
  authenticated: boolean;
  passwordRequired: boolean;
}

export interface LunarYear {
  year: number;
  start: string;
  ganzhi: string;
  zodiac: string;
  label: string;
}

export interface MetaData {
  scopes: ScopeDefinition[];
  dictKinds: Record<DictKind, { label: string; scopes: Scope[] }>;
  dicts: Record<DictKind, DictOption[]>;
  formulas: Formulas;
  formulaDefaults: Formulas;
  usesPrice: boolean;
  prices: UnitPrice[];
  priceConfigured: boolean;
  variables: string[];
  functions: { name: string; syntax: string; description: string }[];
  today: string;
  lunar: LunarYear | null;
  ocr: { enabled: boolean; model: string };
}

export interface EvaluationData {
  ok: boolean;
  value: FormulaValue;
  error: string;
  missingPrices: string[];
  values: FormulaValues;
  unitPrice: number;
  priceMissing: boolean;
}

export interface RecordsData {
  rows: DecoratedRecord[];
  total: number;
}

interface Totals {
  count: number;
  volume: number;
  amount: number;
}

export interface GroupTotals extends Totals {
  key: string;
}

export type GroupBy = "customer" | "model" | "date" | "scope";

export interface DashboardData {
  kpi: Totals & { customers: number; avgPrice: number; missingPrices: number; amountErrors: number };
  scopes: Record<Scope, Totals & { avgPrice: number }>;
  groups: Record<GroupBy, GroupTotals[]>;
  rows: DecoratedRecord[];
  priceConfigured: boolean;
}
