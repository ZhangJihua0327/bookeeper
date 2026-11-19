/**
 * MySQL 数据访问层。所有方法都是异步的，接口保持窄而稳定，
 * 便于用内存实现（tests/memory-store.mjs）做无数据库测试。
 */

const PRICE_CACHE_TTL_MS = 5000;

export class MysqlStore {
  constructor(pool) {
    this.pool = pool;
    this.priceCache = null;
    this.priceLoadedAt = 0;
  }

  async ping() {
    const rows = await this.query("SELECT 1 AS ok");
    return rows?.[0]?.ok === 1;
  }

  async migrate(schemaSql) {
    const connection = await this.pool.getConnection();
    try {
      await connection.query(schemaSql);
    } finally {
      connection.release();
    }
  }

  async seedDicts(items) {
    if (!items.length) return;
    const values = items.map((item) => [item.kind, item.scope || "both", item.label, item.sort_order || 0]);
    await this.execute(
      "INSERT IGNORE INTO dict_items (kind, scope, label, sort_order) VALUES ?",
      [values],
    );
  }

  async listDicts() {
    return this.query(
      "SELECT id, kind, scope, label, sort_order, active FROM dict_items WHERE active = 1 ORDER BY kind, sort_order, id",
    );
  }

  async addDict({ kind, scope = "both", label, sort_order = 0 }) {
    const result = await this.execute(
      "INSERT INTO dict_items (kind, scope, label, sort_order) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE active = 1, sort_order = VALUES(sort_order)",
      [kind, scope, label, sort_order],
    );
    const id = result.insertId || (await this.findDictId(kind, scope, label));
    return { id, kind, scope, label, sort_order };
  }

  async findDictId(kind, scope, label) {
    const rows = await this.query("SELECT id FROM dict_items WHERE kind = ? AND scope = ? AND label = ? LIMIT 1", [
      kind,
      scope,
      label,
    ]);
    return rows[0]?.id ?? null;
  }

  async updateDict(id, patch) {
    const fields = [];
    const params = [];
    if (patch.label !== undefined) {
      fields.push("label = ?");
      params.push(patch.label);
    }
    if (patch.sort_order !== undefined) {
      fields.push("sort_order = ?");
      params.push(patch.sort_order);
    }
    if (patch.active !== undefined) {
      fields.push("active = ?");
      params.push(patch.active ? 1 : 0);
    }
    if (!fields.length) return null;
    params.push(id);
    await this.execute(`UPDATE dict_items SET ${fields.join(", ")} WHERE id = ?`, params);
    const rows = await this.query("SELECT id, kind, scope, label, sort_order, active FROM dict_items WHERE id = ?", [id]);
    return rows[0] ?? null;
  }

  async deleteDict(id) {
    const result = await this.execute("DELETE FROM dict_items WHERE id = ?", [id]);
    return result.affectedRows > 0;
  }

  async listPrices() {
    const rows = await this.query(
      "SELECT id, scope, customer_name, truck_model, price, note FROM unit_prices ORDER BY scope, customer_name, truck_model",
    );
    return rows.map((row) => ({ ...row, price: Number(row.price) }));
  }

  async savePrice({ id, scope, customer_name = "*", truck_model = "*", price = 0, note = "" }) {
    if (id) {
      await this.execute("UPDATE unit_prices SET customer_name = ?, truck_model = ?, price = ?, note = ? WHERE id = ?", [
        customer_name,
        truck_model,
        price,
        note,
        id,
      ]);
      this.invalidatePrices();
      return { id };
    }
    const result = await this.execute(
      `INSERT INTO unit_prices (scope, customer_name, truck_model, price, note)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE price = VALUES(price), note = VALUES(note), id = LAST_INSERT_ID(id)`,
      [scope, customer_name, truck_model, price, note],
    );
    this.invalidatePrices();
    return { id: result.insertId, scope, customer_name, truck_model, price, note };
  }

  async deletePrice(id) {
    const result = await this.execute("DELETE FROM unit_prices WHERE id = ?", [id]);
    this.invalidatePrices();
    return result.affectedRows > 0;
  }

  async getFormulas() {
    const rows = await this.query(
      "SELECT scope, volume_formula, amount_formula, amount_decimals FROM formula_settings",
    );
    const formulas = {};
    for (const row of rows) {
      formulas[row.scope] = {
        volume_formula: row.volume_formula,
        amount_formula: row.amount_formula,
        amount_decimals: Number(row.amount_decimals),
      };
    }
    return formulas;
  }

  async saveFormula({ scope, volume_formula, amount_formula, amount_decimals = 2 }) {
    await this.execute(
      `INSERT INTO formula_settings (scope, volume_formula, amount_formula, amount_decimals)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE volume_formula = VALUES(volume_formula),
         amount_formula = VALUES(amount_formula), amount_decimals = VALUES(amount_decimals)`,
      [scope, volume_formula, amount_formula, amount_decimals],
    );
    return { scope, volume_formula, amount_formula, amount_decimals };
  }

  async listRecords(filter = {}) {
    const { where, params } = buildRecordFilter(filter);
    const limit = Math.min(Math.max(Number(filter.limit) || 5000, 1), 20000);
    const rows = await this.query(
      `SELECT id, scope, entry_date, truck_model, customer_name, volume, remark, unit_price_override
       FROM records ${where} ORDER BY entry_date IS NULL, entry_date DESC, id DESC LIMIT ?`,
      [...params, limit],
    );
    return rows.map(normalizeRecord);
  }

  async getRecord(id) {
    const rows = await this.query(
      `SELECT id, scope, entry_date, truck_model, customer_name, volume, remark, unit_price_override
       FROM records WHERE id = ?`,
      [id],
    );
    return rows[0] ? normalizeRecord(rows[0]) : null;
  }

  async createRecord(input) {
    const result = await this.execute(
      `INSERT INTO records (scope, entry_date, truck_model, customer_name, volume, remark, unit_price_override)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.scope,
        input.entry_date || null,
        input.truck_model || "",
        input.customer_name,
        input.volume,
        input.remark || "",
        input.unit_price_override ?? null,
      ],
    );
    return this.getRecord(result.insertId);
  }

  async updateRecord(id, input) {
    await this.execute(
      `UPDATE records SET scope = ?, entry_date = ?, truck_model = ?, customer_name = ?, volume = ?,
        remark = ?, unit_price_override = ? WHERE id = ?`,
      [
        input.scope,
        input.entry_date || null,
        input.truck_model || "",
        input.customer_name,
        input.volume,
        input.remark || "",
        input.unit_price_override ?? null,
        id,
      ],
    );
    return this.getRecord(id);
  }

  async deleteRecord(id) {
    const result = await this.execute("DELETE FROM records WHERE id = ?", [id]);
    return result.affectedRows > 0;
  }

  invalidatePrices() {
    this.priceCache = null;
    this.priceLoadedAt = 0;
  }

  async ensurePrices() {
    const fresh = this.priceCache && Date.now() - this.priceLoadedAt < PRICE_CACHE_TTL_MS;
    if (fresh) return this.priceCache;

    const rows = await this.query("SELECT scope, customer_name, truck_model, price FROM unit_prices");
    const map = new Map();
    for (const row of rows) {
      map.set(`${row.scope}|${row.customer_name}|${row.truck_model}`, Number(row.price));
    }
    this.priceCache = map;
    this.priceLoadedAt = Date.now();
    return map;
  }

  /**
   * 单价匹配顺序：客户+车型 → 客户默认 → 车型默认 → 全局默认。
   */
  async resolvePrice(scope, customerName, truckModel) {
    const map = await this.ensurePrices();
    const customer = customerName || "*";
    const model = truckModel || "*";
    const candidates = [
      [customer, model],
      [customer, "*"],
      ["*", model],
      ["*", "*"],
    ];

    for (const [c, m] of candidates) {
      const key = `${scope}|${c}|${m}`;
      if (map.has(key)) {
        return { price: map.get(key), missing: false, source: `${c}/${m}` };
      }
    }
    return { price: 0, missing: true, source: "" };
  }

  async query(sql, params = []) {
    const [rows] = await this.pool.query(sql, params);
    return rows;
  }

  async execute(sql, params = []) {
    const [result] = await this.pool.query(sql, params);
    return result;
  }
}

export function buildRecordFilter(filter = {}) {
  const where = [];
  const params = [];

  if (filter.scope && filter.scope !== "all") {
    where.push("scope = ?");
    params.push(filter.scope);
  }
  if (filter.from) {
    where.push("entry_date >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("entry_date <= ?");
    params.push(filter.to);
  }
  if (filter.customer) {
    where.push("customer_name = ?");
    params.push(filter.customer);
  }
  if (filter.model) {
    where.push("truck_model = ?");
    params.push(filter.model);
  }
  if (filter.q) {
    const like = `%${filter.q}%`;
    where.push("(customer_name LIKE ? OR truck_model LIKE ? OR remark LIKE ?)");
    params.push(like, like, like);
  }

  return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

function normalizeRecord(row) {
  return {
    id: Number(row.id),
    scope: row.scope,
    entry_date: row.entry_date ? formatDate(row.entry_date) : "",
    truck_model: row.truck_model || "",
    customer_name: row.customer_name || "",
    volume: Number(row.volume) || 0,
    remark: row.remark || "",
    unit_price_override:
      row.unit_price_override === null || row.unit_price_override === undefined
        ? null
        : Number(row.unit_price_override),
  };
}

function formatDate(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}
