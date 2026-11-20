import type {
  DictInput, DictItem, DictPatch, FormulaInput, Formulas, LedgerRecord, PriceInput,
  RecordFilters, RecordInput, UnitPrice,
} from "../shared/types.js";

export interface LedgerStore {
  ping(): Promise<boolean>;
  migrate(schemaSql: string): Promise<unknown>;
  seedDicts(items: DictInput[]): Promise<void>;
  listDicts(): Promise<DictItem[]>;
  addDict(input: DictInput): Promise<Omit<DictItem, "active" | "id"> & { id: number | null }>;
  updateDict(id: number, patch: DictPatch): Promise<DictItem | null>;
  deleteDict(id: number): Promise<boolean>;
  listPrices(): Promise<UnitPrice[]>;
  savePrice(input: PriceInput): Promise<Pick<UnitPrice, "id"> | null>;
  deletePrice(id: number): Promise<boolean>;
  getFormulas(): Promise<Partial<Formulas>>;
  saveFormula(input: FormulaInput): Promise<unknown>;
  listRecords(filter?: RecordFilters): Promise<LedgerRecord[]>;
  getRecord(id: number): Promise<LedgerRecord | null>;
  createRecord(input: RecordInput): Promise<LedgerRecord | null>;
  updateRecord(id: number, input: RecordInput): Promise<LedgerRecord | null>;
  deleteRecord(id: number): Promise<boolean>;
}
