import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSessionCookie,
  clearSessionCookie,
  createLoginLimiter,
  parseCookies,
  safeEqual,
  SESSION_COOKIE,
  signSession,
  verifySession,
} from "./auth.js";
import {
  computeAmount,
  evaluateFormula,
  FORMULA_FUNCTIONS,
  FORMULA_VARIABLES,
  parseFormula,
} from "./formula.js";
import { buildPriceIndex } from "./prices.js";
import { DEFAULT_OCR_MODEL, recognizeLedger } from "./ocr.js";
import { DICT_KINDS, formatDate, isScope, SCOPE_KEYS, SCOPES, scopeDef, toFormulaValues } from "./scopes.js";
import { DEFAULT_FORMULAS } from "./seed.js";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(join(here, "..", "public"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

const BODY_LIMIT = 256 * 1024;

export class HttpError extends Error {
  constructor(status, message, code = "") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function createApp({ store, config, logger = console }) {
  const limiter = createLoginLimiter();

  return async function handle(request, response) {
    const url = new URL(request.url || "/", "http://localhost");
    const method = (request.method || "GET").toUpperCase();

    try {
      const path = decodeURIComponent(url.pathname);
      if (!path.startsWith("/api/")) {
        await serveStatic(request, response, path, method);
        return;
      }

      await handleApi({ request, response, url, path, method, store, config, logger, limiter });
    } catch (error) {
      if (error instanceof HttpError) {
        json(response, error.status, { ok: false, error: error.message, code: error.code });
        return;
      }
      logger.error?.("[app] 未处理的错误", error);
      if (!response.headersSent) {
        json(response, 500, { ok: false, error: "服务器内部错误" });
      } else {
        response.end();
      }
    }
  };
}

async function handleApi({ request, response, url, path, method, store, config, logger, limiter }) {
  // ---------- 公开接口 ----------
  if (method === "GET" && path === "/api/health") {
    const dbOk = await store.ping().catch(() => false);
    json(response, dbOk ? 200 : 503, {
      ok: dbOk,
      db: dbOk ? "up" : "down",
      time: new Date().toISOString(),
      version: "2.0.0",
    });
    return;
  }

  if (method === "GET" && path === "/api/session") {
    const authenticated = isAuthenticated(request, config);
    json(response, 200, { ok: true, data: { authenticated, passwordRequired: Boolean(config.appPassword) } });
    return;
  }

  if (method === "POST" && path === "/api/login") {
    const body = await readJson(request);
    if (!config.appPassword) throw new HttpError(400, "服务未设置访问密码，直接打开即可");
    const key = clientKey(request);
    const limit = limiter.check(key);
    if (!limit.allowed) throw new HttpError(429, "尝试次数过多，请稍后再试");

    const password = String(body.password ?? "");
    if (!password || !safeEqual(password, config.appPassword)) {
      throw new HttpError(401, "密码不正确");
    }

    limiter.reset(key);
    const token = signSession(config.sessionSecret, config.sessionTtlMs);
    const cookie = buildSessionCookie(token, { ttlMs: config.sessionTtlMs, secure: isSecure(request) });
    response.setHeader("Set-Cookie", cookie);
    json(response, 200, { ok: true, data: { authenticated: true } });
    return;
  }

  if (method === "POST" && path === "/api/logout") {
    response.setHeader("Set-Cookie", clearSessionCookie());
    json(response, 200, { ok: true, data: { authenticated: false } });
    return;
  }

  // ---------- 以下接口需要登录 ----------
  if (!isAuthenticated(request, config)) {
    throw new HttpError(401, "请先登录", "unauthorized");
  }

  if (method === "GET" && path === "/api/meta") {
    const [dicts, formulas, prices] = await Promise.all([
      store.listDicts(),
      store.getFormulas(),
      store.listPrices(),
    ]);
    const grouped = { customer: [], truck_model: [] };
    for (const item of dicts) {
      if (grouped[item.kind]) {
        grouped[item.kind].push({ id: item.id, label: item.label, scope: item.scope, sort_order: item.sort_order });
      }
    }
    const priceIndex = buildPriceIndex(prices);
    json(response, 200, {
      ok: true,
      data: {
        scopes: SCOPE_KEYS.map((key) => ({
          key,
          label: SCOPES[key].label,
          tableName: SCOPES[key].tableName,
          fields: SCOPES[key].fields,
        })),
        dictKinds: DICT_KINDS,
        dicts: grouped,
        formulas: { ...DEFAULT_FORMULAS, ...formulas },
        prices,
        priceConfigured: SCOPE_KEYS.some((key) => priceIndex.hasPositive(key)),
        variables: FORMULA_VARIABLES,
        functions: FORMULA_FUNCTIONS,
        today: todayInZone(config.timeZone),
        ocr: { enabled: Boolean(config.dashscope?.apiKey), model: config.dashscope?.model || DEFAULT_OCR_MODEL },
      },
    });
    return;
  }

  if (method === "GET" && path === "/api/records") {
    const filters = readFilters(url);
    const context = await loadContext(store, filters);
    const rows = context.records.map((row) => decorate(row, context.formulas, context.priceIndex));
    json(response, 200, { ok: true, data: { rows, total: rows.length } });
    return;
  }

  if (method === "GET" && path === "/api/dashboard") {
    const filters = readFilters(url);
    const context = await loadContext(store, filters);
    const rows = context.records.map((row) => decorate(row, context.formulas, context.priceIndex));
    json(response, 200, { ok: true, data: buildDashboard(rows, context) });
    return;
  }

  if (method === "GET" && path === "/api/export.csv") {
    const filters = readFilters(url);
    const context = await loadContext(store, filters);
    const rows = context.records.map((row) => decorate(row, context.formulas, context.priceIndex));
    const csv = buildCsv(rows);
    response.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bookeeper-${filters.from || "all"}-${filters.to || "now"}.csv"`,
      "Cache-Control": "no-store",
    });
    response.end("\uFEFF" + csv);
    return;
  }

  if (method === "POST" && path === "/api/ocr") {
    if (!config.dashscope?.apiKey) {
      throw new HttpError(503, "服务端没有配置 DASHSCOPE_API_KEY，无法识别图片");
    }

    const body = await readJson(request, 8 * 1024 * 1024);
    const image = String(body.image || "");
    const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(image);
    if (!match) throw new HttpError(400, "请上传 JPEG / PNG / WebP 图片");

    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length) throw new HttpError(400, "图片内容为空");
    if (bytes.length > 6 * 1024 * 1024) throw new HttpError(413, "图片过大（上限 6MB），请压缩后重试");

    const dicts = await store.listDicts();
    let result;
    try {
      result = await recognizeLedger({
        apiKey: config.dashscope.apiKey,
        model: config.dashscope.model,
        imageDataUrl: image,
        dicts: {
          customers: dicts.filter((item) => item.kind === "customer").map((item) => item.label),
          truckModels: dicts.filter((item) => item.kind === "truck_model").map((item) => item.label),
        },
        today: todayInZone(config.timeZone),
        timeoutMs: config.dashscope.timeoutMs,
      });
    } catch (error) {
      logger.error?.("[ocr] 识别失败", error?.message || error);
      throw new HttpError(502, `识别失败：${error.message || error}`);
    }

    json(response, 200, { ok: true, data: { ...result, model: config.dashscope.model } });
    return;
  }

  if (method === "POST" && path === "/api/records") {
    const body = await readJson(request);
    const formulas = await store.getFormulas();
    const data = normalizeRecordInput(body, { ...DEFAULT_FORMULAS, ...formulas });
    const created = await store.createRecord(data);
    const context = await loadContext(store, { scope: created.scope, limit: 1 });
    const decorated = decorate(created, context.formulas, context.priceIndex);
    json(response, 201, { ok: true, data: decorated });
    return;
  }

  const recordMatch = /^\/api\/records\/(\d+)$/.exec(path);
  if (recordMatch) {
    const id = Number(recordMatch[1]);
    if (method === "PUT") {
      const body = await readJson(request);
      const existing = await store.getRecord(id);
      if (!existing) throw new HttpError(404, "记录不存在");
      const formulas = await store.getFormulas();
      const data = normalizeRecordInput({ ...body, scope: body.scope || existing.scope }, {
        ...DEFAULT_FORMULAS,
        ...formulas,
      });
      const updated = await store.updateRecord(id, data);
      const context = await loadContext(store, { scope: updated.scope, limit: 1 });
      json(response, 200, { ok: true, data: decorate(updated, context.formulas, context.priceIndex) });
      return;
    }
    if (method === "DELETE") {
      const deleted = await store.deleteRecord(id);
      if (!deleted) throw new HttpError(404, "记录不存在");
      json(response, 200, { ok: true, data: { deleted: true } });
      return;
    }
  }

  if (method === "POST" && path === "/api/evaluate") {
    const body = await readJson(request);
    const scope = String(body.scope || "pump");
    if (!isScope(scope)) throw new HttpError(400, "表类型不正确");
    const expression = String(body.expression ?? "").trim();
    if (!expression) throw new HttpError(400, "公式不能为空");

    const prices = await store.listPrices();
    const priceIndex = buildPriceIndex(prices);
    const values = toFormulaValues(scope, {
      entry_date: body.entry_date,
      truck_model: body.truck_model,
      customer_name: body.customer_name,
      volume: body.volume,
      remark: body.remark,
    });
    const price = priceIndex.resolve(scope, values["客户名称"], values["车型"]);
    values["单价"] = price.price;

    const result = evaluateFormula(expression, values, (customer, model) =>
      priceIndex.resolve(scope, customer, model),
    );
    json(response, 200, {
      ok: true,
      data: {
        ...result,
        values,
        unitPrice: price.price,
        priceMissing: price.missing,
      },
    });
    return;
  }

  if (method === "POST" && path === "/api/dicts") {
    const body = await readJson(request);
    const kind = String(body.kind || "");
    if (!DICT_KINDS[kind]) throw new HttpError(400, "字典类型不正确");
    const label = String(body.label ?? "").trim();
    if (!label) throw new HttpError(400, "名称不能为空");
    if (label.length > 64) throw new HttpError(400, "名称过长");
    const item = await store.addDict({ kind, scope: body.scope || "both", label });
    json(response, 201, { ok: true, data: item });
    return;
  }

  const dictMatch = /^\/api\/dicts\/(\d+)$/.exec(path);
  if (dictMatch) {
    const id = Number(dictMatch[1]);
    if (method === "DELETE") {
      const deleted = await store.deleteDict(id);
      if (!deleted) throw new HttpError(404, "选项不存在");
      json(response, 200, { ok: true, data: { deleted: true } });
      return;
    }
    if (method === "PUT") {
      const body = await readJson(request);
      const patch = {};
      if (body.label !== undefined) {
        const label = String(body.label).trim();
        if (!label) throw new HttpError(400, "名称不能为空");
        patch.label = label;
      }
      if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0;
      if (body.active !== undefined) patch.active = Boolean(body.active);
      const updated = await store.updateDict(id, patch);
      if (!updated) throw new HttpError(404, "选项不存在");
      json(response, 200, { ok: true, data: updated });
      return;
    }
  }

  if (method === "POST" && path === "/api/prices") {
    const body = await readJson(request);
    const scope = String(body.scope || "");
    if (!isScope(scope)) throw new HttpError(400, "表类型不正确");
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, "单价必须是不小于 0 的数字");
    const saved = await store.savePrice({
      scope,
      customer_name: String(body.customer_name || "*").trim() || "*",
      truck_model: String(body.truck_model || "*").trim() || "*",
      price,
      note: String(body.note || "").trim().slice(0, 255),
    });
    json(response, 201, { ok: true, data: saved });
    return;
  }

  const priceMatch = /^\/api\/prices\/(\d+)$/.exec(path);
  if (priceMatch && method === "DELETE") {
    const deleted = await store.deletePrice(Number(priceMatch[1]));
    if (!deleted) throw new HttpError(404, "单价不存在");
    json(response, 200, { ok: true, data: { deleted: true } });
    return;
  }
  if (priceMatch && method === "PUT") {
    const body = await readJson(request);
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, "单价必须是不小于 0 的数字");
    const saved = await store.savePrice({
      id: Number(priceMatch[1]),
      scope: body.scope,
      customer_name: String(body.customer_name || "*").trim() || "*",
      truck_model: String(body.truck_model || "*").trim() || "*",
      price,
      note: String(body.note || "").trim().slice(0, 255),
    });
    if (!saved) throw new HttpError(404, "单价不存在");
    json(response, 200, { ok: true, data: saved });
    return;
  }

  if (method === "PUT" && path === "/api/formulas") {
    const body = await readJson(request);
    const scope = String(body.scope || "");
    if (!isScope(scope)) throw new HttpError(400, "表类型不正确");

    const volumeFormula = String(body.volume_formula ?? "").trim();
    const amountFormula = String(body.amount_formula ?? "").trim();
    if (!volumeFormula) throw new HttpError(400, "方量公式不能为空");
    if (!amountFormula) throw new HttpError(400, "金额公式不能为空");

    for (const [name, formula] of [
      ["方量公式", volumeFormula],
      ["金额公式", amountFormula],
    ]) {
      try {
        parseFormula(formula);
      } catch (error) {
        throw new HttpError(400, `${name}语法错误：${error.message}`);
      }
    }

    const decimals = clampDecimals(body.amount_decimals);
    const saved = await store.saveFormula({
      scope,
      volume_formula: volumeFormula,
      amount_formula: amountFormula,
      amount_decimals: decimals,
    });
    json(response, 200, { ok: true, data: saved });
    return;
  }

  throw new HttpError(404, "接口不存在", "not_found");
}

// ---------------------------------------------------------------- 静态文件

async function serveStatic(request, response, path, method) {
  if (method !== "GET" && method !== "HEAD") {
    throw new HttpError(405, "不支持的请求方法");
  }

  const relative = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const filePath = resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    throw new HttpError(403, "禁止访问");
  }

  let content;
  try {
    content = await readFile(filePath);
  } catch {
    throw new HttpError(404, "页面不存在");
  }

  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": type,
    "Content-Length": content.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (method === "HEAD") {
    response.end();
    return;
  }
  response.end(content);
}

// ---------------------------------------------------------------- 数据组装

async function loadContext(store, filters) {
  const [formulas, prices, records] = await Promise.all([
    store.getFormulas(),
    store.listPrices(),
    store.listRecords(filters),
  ]);

  return {
    formulas: { ...DEFAULT_FORMULAS, ...formulas },
    prices,
    priceIndex: buildPriceIndex(prices),
    records,
  };
}

export function decorate(record, formulas, priceIndex) {
  const scope = isScope(record.scope) ? record.scope : "pump";
  const formula = formulas[scope] || DEFAULT_FORMULAS[scope];
  const values = toFormulaValues(scope, record);
  const usesPrice = String(formula.amount_formula).includes("单价");

  const price = priceIndex.resolve(scope, record.customer_name, record.truck_model);
  values["单价"] = price.price;

  const result = computeAmount(
    formula.amount_formula,
    values,
    (customer, model) => priceIndex.resolve(scope, customer, model),
    formula.amount_decimals,
  );

  // 手动金额优先；没填就用公式算出来的默认值
  const manual =
    record.amount_override !== null && record.amount_override !== undefined
      ? Number(record.amount_override)
      : null;

  return {
    ...record,
    scope_label: SCOPES[scope].label,
    amount: manual === null ? result.amount : round2(manual),
    amount_formula_value: result.amount,
    amount_source: manual === null ? "formula" : "manual",
    unit_price: price.price,
    price_missing: usesPrice ? price.missing : false,
    amount_error: result.error,
  };
}

export function buildDashboard(rows, context) {
  const kpi = {
    count: rows.length,
    volume: 0,
    amount: 0,
    customers: new Set(),
    missingPrices: 0,
    amountErrors: 0,
  };

  const byScope = {
    pump: { count: 0, volume: 0, amount: 0 },
    mixer: { count: 0, volume: 0, amount: 0 },
  };

  for (const row of rows) {
    const volume = Number(row.volume) || 0;
    const amount = Number(row.amount) || 0;

    kpi.volume += volume;
    kpi.amount += amount;
    if (row.customer_name) kpi.customers.add(row.customer_name);
    if (row.price_missing) kpi.missingPrices += 1;
    if (row.amount_error) kpi.amountErrors += 1;

    const bucket = byScope[row.scope];
    if (bucket) {
      bucket.count += 1;
      bucket.volume += volume;
      bucket.amount += amount;
    }
  }

  return {
    kpi: {
      count: kpi.count,
      volume: round3(kpi.volume),
      amount: round2(kpi.amount),
      customers: kpi.customers.size,
      avgPrice: kpi.volume > 0 ? round2(kpi.amount / kpi.volume) : 0,
      missingPrices: kpi.missingPrices,
      amountErrors: kpi.amountErrors,
    },
    scopes: {
      pump: {
        count: byScope.pump.count,
        volume: round3(byScope.pump.volume),
        amount: round2(byScope.pump.amount),
        avgPrice: byScope.pump.volume > 0 ? round2(byScope.pump.amount / byScope.pump.volume) : 0,
      },
      mixer: {
        count: byScope.mixer.count,
        volume: round3(byScope.mixer.volume),
        amount: round2(byScope.mixer.amount),
        avgPrice: byScope.mixer.volume > 0 ? round2(byScope.mixer.amount / byScope.mixer.volume) : 0,
      },
    },
    groups: {
      customer: groupRows(rows, (row) => row.customer_name || "未填写客户", "customer"),
      model: groupRows(rows, (row) => row.truck_model || "未填写车型", "model"),
      date: groupRows(rows, (row) => row.entry_date || "未填日期", "date").sort((a, b) => {
        if (a.key === "未填日期") return 1;
        if (b.key === "未填日期") return -1;
        return a.key < b.key ? -1 : 1;
      }),
      scope: groupRows(rows, (row) => row.scope_label || row.scope, "scope"),
    },
    rows,
    priceConfigured:
      !SCOPE_KEYS.some((key) => String(context.formulas[key]?.amount_formula || "").includes("单价")) ||
      SCOPE_KEYS.some((key) => context.priceIndex.hasPositive(key)),
  };
}

function groupRows(rows, keyFn, order) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = groups.get(key) || { key, count: 0, volume: 0, amount: 0 };
    current.count += 1;
    current.volume += Number(row.volume) || 0;
    current.amount += Number(row.amount) || 0;
    groups.set(key, current);
  }
  const list = [...groups.values()].map((item) => ({
    ...item,
    volume: round3(item.volume),
    amount: round2(item.amount),
  }));
  if (order === "date") return list;
  return list.sort((a, b) => b.amount - a.amount || b.volume - a.volume);
}

// ---------------------------------------------------------------- 输入处理

export function normalizeRecordInput(body, formulas) {
  const scope = String(body.scope ?? "");
  if (!isScope(scope)) throw new HttpError(400, "表类型不正确");

  const data = {
    scope,
    entry_date: String(body.entry_date ?? "").trim(),
    truck_model: String(body.truck_model ?? "").trim().slice(0, 64),
    customer_name: String(body.customer_name ?? "").trim().slice(0, 128),
    remark: String(body.remark ?? "").trim().slice(0, 1000),
    amount_override: null,
  };

  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.entry_date) || Number.isNaN(Date.parse(data.entry_date))) {
    errors.push("日期格式应为 YYYY-MM-DD");
  }

  // 金额留空 → 用公式算；填了 → 以手填值为准
  if (body.amount_override !== undefined && body.amount_override !== null && body.amount_override !== "") {
    const override = Number(body.amount_override);
    if (!Number.isFinite(override) || override < 0) errors.push("金额必须是不小于 0 的数字");
    else data.amount_override = round2(override);
  }

  let volume = body.volume === "" || body.volume === null || body.volume === undefined ? NaN : Number(body.volume);
  if (!Number.isFinite(volume)) {
    // 方量留空：按“方量公式”从其它列（例如备注里的算式）推导
    const formula = formulas?.[scope]?.volume_formula;
    if (formula) {
      const values = toFormulaValues(scope, { ...data, volume: 0 });
      values["单价"] = 0;
      const result = evaluateFormula(formula, values, () => ({ price: 0, missing: true }));
      if (result.ok && Number.isFinite(Number(result.value)) && Number(result.value) > 0) {
        volume = Number(result.value);
      }
    }
  }
  if (!Number.isFinite(volume) || volume <= 0) {
    errors.push("方量必须大于 0（也可以在备注里写算式，如 12*2+11，由公式自动计算）");
  } else {
    data.volume = Math.round(volume * 1000) / 1000;
  }

  for (const field of scopeDef(scope).fields) {
    if (!field.required) continue;
    if (field.key === "volume") continue;
    if (!data[field.key]) errors.push(`${field.label}不能为空`);
  }

  if (errors.length) throw new HttpError(400, errors.join("；"));
  return data;
}

function readFilters(url) {
  const params = url.searchParams;
  const scope = params.get("scope");
  return {
    scope: scope && isScope(scope) ? scope : "all",
    from: dateOnly(params.get("from")),
    to: dateOnly(params.get("to")),
    customer: (params.get("customer") || "").trim(),
    model: (params.get("model") || "").trim(),
    q: (params.get("q") || "").trim(),
    limit: Math.min(Number(params.get("limit")) || 5000, 20000),
  };
}

function buildCsv(rows) {
  const header = ["表", "日期", "车型", "客户名称", "方量", "单价", "金额", "备注", "计价方式"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.scope_label,
        formatDate(row.entry_date),
        row.truck_model,
        row.customer_name,
        row.volume,
        row.unit_price,
        row.amount,
        row.remark,
        row.amount_source === "manual" ? "手动" : "公式",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

// ---------------------------------------------------------------- 基础设施

function isAuthenticated(request, config) {
  if (!config.appPassword) return true;
  const cookies = parseCookies(request.headers.cookie);
  return verifySession(config.sessionSecret, cookies[SESSION_COOKIE]);
}

function isSecure(request) {
  const proto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return proto === "https" || Boolean(request.socket?.encrypted);
}

function clientKey(request) {
  return (
    String(request.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    request.socket?.remoteAddress ||
    "unknown"
  );
}

async function readJson(request, limit = BODY_LIMIT) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "请求体过大");
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON");
  }
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function dateOnly(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function clampDecimals(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 2;
  return Math.min(Math.max(Math.trunc(number), 0), 4);
}

export function todayInZone(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round3(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
