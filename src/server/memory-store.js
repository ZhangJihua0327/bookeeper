/**
 * 内存版 store，接口与 MysqlStore 一致，仅用于测试。
 */

import { buildPriceIndex } from "./prices.js";

export class MemoryStore {
  constructor() {
    this.dicts = [];
    this.prices = [];
    this.formulas = {};
    this.records = [];
    this.dictId = 1;
    this.priceId = 1;
    this.recordId = 1;
  }

  async ping() {
    return true;
  }

  async migrate() {
    return true;
  }

  async seedDicts(items) {
    for (const item of items) {
      const exists = this.dicts.some(
        (entry) => entry.kind === item.kind && entry.scope === (item.scope || "both") && entry.label === item.label,
      );
      if (!exists) {
        this.dicts.push({
          id: this.dictId++,
          kind: item.kind,
          scope: item.scope || "both",
          label: item.label,
          sort_order: item.sort_order || 0,
          active: 1,
        });
      }
    }
  }

  async listDicts() {
    return this.dicts.filter((item) => item.active === 1);
  }

  async addDict({ kind, scope = "both", label, sort_order = 0 }) {
    const existing = this.dicts.find(
      (item) => item.kind === kind && item.scope === scope && item.label === label,
    );
    if (existing) {
      existing.active = 1;
      return { ...existing };
    }
    const item = { id: this.dictId++, kind, scope, label, sort_order, active: 1 };
    this.dicts.push(item);
    return { ...item };
  }

  async updateDict(id, patch) {
    const item = this.dicts.find((entry) => entry.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    return { ...item };
  }

  async deleteDict(id) {
    const index = this.dicts.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.dicts.splice(index, 1);
    return true;
  }

  async listPrices() {
    return this.prices.map((item) => ({ ...item }));
  }

  async savePrice({ id, scope, customer_name = "*", truck_model = "*", price = 0, note = "" }) {
    const numeric = Number(price) || 0;
    if (id) {
      const item = this.prices.find((entry) => entry.id === id);
      if (!item) return null;
      Object.assign(item, { customer_name, truck_model, price: numeric, note });
      return { ...item };
    }
    const existing = this.prices.find(
      (entry) =>
        entry.scope === scope && entry.customer_name === customer_name && entry.truck_model === truck_model,
    );
    if (existing) {
      existing.price = numeric;
      existing.note = note;
      return { ...existing };
    }
    const item = { id: this.priceId++, scope, customer_name, truck_model, price: numeric, note };
    this.prices.push(item);
    return { ...item };
  }

  async deletePrice(id) {
    const index = this.prices.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.prices.splice(index, 1);
    return true;
  }

  async getFormulas() {
    return JSON.parse(JSON.stringify(this.formulas));
  }

  async saveFormula({ scope, volume_formula, amount_formula, amount_decimals = 2 }) {
    this.formulas[scope] = { volume_formula, amount_formula, amount_decimals: Number(amount_decimals) };
    return { scope, ...this.formulas[scope] };
  }

  async listRecords(filter = {}) {
    let rows = [...this.records];
    if (filter.scope && filter.scope !== "all") rows = rows.filter((row) => row.scope === filter.scope);
    if (filter.from) rows = rows.filter((row) => row.entry_date >= filter.from);
    if (filter.to) rows = rows.filter((row) => row.entry_date <= filter.to);
    if (filter.customer) rows = rows.filter((row) => row.customer_name === filter.customer);
    if (filter.model) rows = rows.filter((row) => row.truck_model === filter.model);
    if (filter.q) {
      const q = filter.q;
      rows = rows.filter((row) =>
        [row.customer_name, row.truck_model, row.remark].some((value) => String(value).includes(q)),
      );
    }
    rows.sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : b.id - a.id));
    return rows.map((row) => ({ ...row }));
  }

  async getRecord(id) {
    const row = this.records.find((entry) => entry.id === Number(id));
    return row ? { ...row } : null;
  }

  async createRecord(input) {
    const row = {
      id: this.recordId++,
      scope: input.scope,
      entry_date: input.entry_date || "",
      truck_model: input.truck_model || "",
      customer_name: input.customer_name,
      volume: Number(input.volume),
      remark: input.remark || "",
      unit_price_override: input.unit_price_override ?? null,
    };
    this.records.push(row);
    return { ...row };
  }

  async updateRecord(id, input) {
    const row = this.records.find((entry) => entry.id === Number(id));
    if (!row) return null;
    Object.assign(row, {
      scope: input.scope,
      entry_date: input.entry_date || "",
      truck_model: input.truck_model || "",
      customer_name: input.customer_name,
      volume: Number(input.volume),
      remark: input.remark || "",
      unit_price_override: input.unit_price_override ?? null,
    });
    return { ...row };
  }

  async deleteRecord(id) {
    const index = this.records.findIndex((entry) => entry.id === Number(id));
    if (index < 0) return false;
    this.records.splice(index, 1);
    return true;
  }

  async resolvePrice(scope, customerName, truckModel) {
    const index = buildPriceIndex(this.prices);
    return index.resolve(scope, customerName, truckModel);
  }
}
