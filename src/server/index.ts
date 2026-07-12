import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config, getMissingConfig } from "./config.js";
import { FeishuApiError, FeishuBitableClient } from "./feishu.js";
import {
  buildYesterdayReport,
  getYesterdayDate,
  makeMixerTruckFields,
  makePumpTruckFields,
  normalizeMixerRecords,
  normalizePumpRecords,
  parseMixerTruckRemark,
  validateMixerTruck,
  validatePumpTruck,
  type MixerTruckInput,
  type PumpTruckInput,
  type VehicleReport,
} from "./report.js";
import { ExpiringRequestCache, IdempotencyConflictError } from "./request-cache.js";

interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
}

interface CreatePumpTruckInput extends PumpTruckInput {
  addMissingOptions?: boolean;
  submissionId?: string;
}

interface CreateMixerTruckInput extends MixerTruckInput {
  addMissingOptions?: boolean;
  submissionId?: string;
}

interface AddOptionInput {
  table: "pumpTruck" | "mixerTruck";
  field: string;
  value: string;
}

type RouteHandler = (ctx: RouteContext) => Promise<void>;

interface ReportCacheEntry {
  expiresAt: number;
  report?: VehicleReport;
  pending?: Promise<VehicleReport>;
}

interface OptionSets {
  pumpTruck: { truckModel: string[]; customerName: string[] };
  mixerTruck: { customerName: string[]; drivers: string[] };
}

interface OptionCacheEntry {
  expiresAt: number;
  value?: OptionSets;
  pending?: Promise<OptionSets>;
}

interface CreateRecordResult {
  record: unknown;
  fields: Record<string, unknown>;
  addedOptions: string[];
}

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const missingConfig = getMissingConfig();

const feishu = new FeishuBitableClient({
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  appToken: config.bitable.appToken,
  baseUrl: config.feishu.baseUrl,
});

const reportCache = new Map<string, ReportCacheEntry>();
const reportCacheTtlMs = 5 * 60 * 1000;
const submissionCache = new ExpiringRequestCache<CreateRecordResult>(10 * 60 * 1000);
let optionCache: OptionCacheEntry | null = null;
let optionCacheVersion = 0;
const optionCacheTtlMs = 5 * 60 * 1000;

const routes: Record<string, RouteHandler> = {
  "GET /api/health": handleHealth,
  "GET /api/options": handleOptions,
  "POST /api/options": handleAddOption,
  "GET /api/report/yesterday": handleYesterdayReport,
  "GET /api/records/recent": handleRecentRecords,
  "POST /api/records/pump-truck": handleCreatePumpTruck,
  "POST /api/records/mixer-truck": handleCreateMixerTruck,
};

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);
  res.once("finish", () => {
    console.log(`${requestId} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  res.once("close", () => {
    if (!res.writableFinished) {
      console.warn(`${requestId} ${req.method} ${req.url} connection closed after ${Date.now() - startedAt}ms`);
    }
  });

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const route = routes[`${req.method} ${url.pathname}`];

    if (route) {
      await route({ req, res, url });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(url.pathname, res);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(config.port, () => {
  console.log(`Bookeeper is running at http://localhost:${config.port}`);
  if (missingConfig.length) {
    console.warn(`Missing Feishu config: ${missingConfig.join(", ")}`);
  }
});

async function handleHealth({ res }: RouteContext): Promise<void> {
  sendJson(res, 200, {
    ok: true,
    configured: missingConfig.length === 0,
    missingConfig,
    fields: config.bitable.fields,
  });
}

async function handleOptions({ res }: RouteContext): Promise<void> {
  ensureConfigured();
  sendJson(res, 200, await getOptionSets());
}

async function handleAddOption({ req, res }: RouteContext): Promise<void> {
  ensureConfigured();
  const input = await readJson<AddOptionInput>(req);
  const target = optionTarget(input.table, input.field);
  const result = await feishu.addFieldOption(target.tableId, target.fieldName, input.value || "");
  if (result.added) invalidateOptionCache();
  sendJson(res, 200, result);
}

async function handleCreatePumpTruck({ req, res }: RouteContext): Promise<void> {
  ensureConfigured();
  const input = await readJson<CreatePumpTruckInput>(req);
  const errors = validatePumpTruck(input);
  if (errors.length) {
    sendJson(res, 400, { error: "泵车表单校验失败", details: errors });
    return;
  }

  const result = await createIdempotently("pump-truck", input, async () => {
    const addedOptions = input.addMissingOptions === false ? [] : await Promise.all([
      feishu.ensureFieldOptions(config.bitable.pumpTruckTableId, config.bitable.fields.pumpTruck.truckModel, [input.truckModel]),
      feishu.ensureFieldOptions(config.bitable.pumpTruckTableId, config.bitable.fields.pumpTruck.customerName, [input.customerName]),
    ]).then((items) => items.flat());

    const fields = makePumpTruckFields(input, config.bitable.fields.pumpTruck);
    const record = await feishu.createRecord(config.bitable.pumpTruckTableId, fields);
    invalidateReportCache(input.date);
    if (addedOptions.length) invalidateOptionCache();
    return { record, fields, addedOptions };
  });
  sendJson(res, result.replayed ? 200 : 201, { ...result.value, replayed: result.replayed });
}

async function handleCreateMixerTruck({ req, res }: RouteContext): Promise<void> {
  ensureConfigured();
  const input = await readJson<CreateMixerTruckInput>(req);
  const errors = validateMixerTruck(input);
  if (errors.length) {
    sendJson(res, 400, { error: "搅拌车表单校验失败", details: errors });
    return;
  }

  const result = await createIdempotently("mixer-truck", input, async () => {
    const generated = parseMixerTruckRemark(input.remark);
    const addedOptions = input.addMissingOptions === false ? [] : await Promise.all([
      feishu.ensureFieldOptions(config.bitable.mixerTruckTableId, config.bitable.fields.mixerTruck.customerName, [input.customerName]),
      feishu.ensureFieldOptions(config.bitable.mixerTruckTableId, config.bitable.fields.mixerTruck.drivers, generated.drivers),
    ]).then((items) => items.flat());

    const fields = makeMixerTruckFields(input, config.bitable.fields.mixerTruck);
    const record = await feishu.createRecord(config.bitable.mixerTruckTableId, fields);
    invalidateReportCache(input.date);
    if (addedOptions.length) invalidateOptionCache();
    return { record, fields, addedOptions };
  });
  sendJson(res, result.replayed ? 200 : 201, { ...result.value, replayed: result.replayed });
}

async function handleYesterdayReport({ res, url }: RouteContext): Promise<void> {
  ensureConfigured();
  const yesterday = getYesterdayDate(config.timeZone);
  const date = url.searchParams.get("date") || yesterday;
  const forceRefresh = url.searchParams.get("refresh") === "1";
  const report = date === yesterday
    ? await getCachedReport(date, forceRefresh)
    : await buildReportForDate(date);
  sendJson(res, 200, report);
}

async function getCachedReport(date: string, forceRefresh: boolean): Promise<VehicleReport> {
  const now = Date.now();
  const cached = reportCache.get(date);
  if (!forceRefresh && cached) {
    if (cached.report && cached.expiresAt > now) return cached.report;
    if (cached.pending) return cached.pending;
  }

  const pending = buildReportForDate(date)
    .then((report) => {
      reportCache.set(date, { report, expiresAt: Date.now() + reportCacheTtlMs });
      return report;
    })
    .catch((error) => {
      reportCache.delete(date);
      throw error;
    });

  reportCache.set(date, { pending, expiresAt: now + reportCacheTtlMs });
  return pending;
}

async function buildReportForDate(date: string): Promise<VehicleReport> {
  const [pumpRecords, mixerRecords] = await Promise.all([
    feishu.listRecords(config.bitable.pumpTruckTableId),
    feishu.listRecords(config.bitable.mixerTruckTableId),
  ]);

  return buildYesterdayReport({
    date,
    pumpRecords,
    mixerRecords,
    fields: config.bitable.fields,
    timeZone: config.timeZone,
  });
}

function invalidateReportCache(date: string): void {
  reportCache.delete(date);
}

async function handleRecentRecords({ res }: RouteContext): Promise<void> {
  ensureConfigured();
  const [pumpRecords, mixerRecords] = await Promise.all([
    feishu.listRecords(config.bitable.pumpTruckTableId, { pageSize: 20, maxPages: 1 }),
    feishu.listRecords(config.bitable.mixerTruckTableId, { pageSize: 20, maxPages: 1 }),
  ]);

  sendJson(res, 200, {
    pumpTruck: normalizePumpRecords(pumpRecords, config.bitable.fields.pumpTruck, config.timeZone).slice(0, 10),
    mixerTruck: normalizeMixerRecords(mixerRecords, config.bitable.fields.mixerTruck, config.timeZone).slice(0, 10),
  });
}

async function getOptionSets(): Promise<OptionSets> {
  const now = Date.now();
  if (optionCache?.value && optionCache.expiresAt > now) return optionCache.value;
  if (optionCache?.pending) return optionCache.pending;

  const version = optionCacheVersion;
  const pending = loadOptionSets();
  optionCache = { pending, expiresAt: now + optionCacheTtlMs };
  try {
    const value = await pending;
    if (optionCacheVersion === version) {
      optionCache = { value, expiresAt: Date.now() + optionCacheTtlMs };
    }
    return value;
  } catch (error) {
    if (optionCacheVersion === version) optionCache = null;
    throw error;
  }
}

async function loadOptionSets(): Promise<OptionSets> {
  const [pumpTruckModel, pumpCustomerName, mixerCustomerName, mixerDrivers] = await Promise.all([
    feishu.getFieldOptions(config.bitable.pumpTruckTableId, config.bitable.fields.pumpTruck.truckModel),
    feishu.getFieldOptions(config.bitable.pumpTruckTableId, config.bitable.fields.pumpTruck.customerName),
    feishu.getFieldOptions(config.bitable.mixerTruckTableId, config.bitable.fields.mixerTruck.customerName),
    feishu.getFieldOptions(config.bitable.mixerTruckTableId, config.bitable.fields.mixerTruck.drivers),
  ]);

  return {
    pumpTruck: {
      truckModel: pumpTruckModel,
      customerName: pumpCustomerName,
    },
    mixerTruck: {
      customerName: mixerCustomerName,
      drivers: mixerDrivers,
    },
  };
}

function invalidateOptionCache(): void {
  optionCacheVersion += 1;
  optionCache = null;
}

async function createIdempotently(
  kind: string,
  input: CreatePumpTruckInput | CreateMixerTruckInput,
  operation: () => Promise<CreateRecordResult>,
): Promise<{ value: CreateRecordResult; replayed: boolean }> {
  const submissionId = input.submissionId?.trim();
  if (!submissionId) return { value: await operation(), replayed: false };
  if (submissionId.length > 128) throw new HttpError(400, "submissionId 过长");

  const { submissionId: ignored, ...payload } = input;
  try {
    return await submissionCache.execute(`${kind}:${submissionId}`, JSON.stringify(payload), operation);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new HttpError(409, error.message);
    }
    throw error;
  }
}

function optionTarget(table: AddOptionInput["table"], field: string): { tableId: string; fieldName: string } {
  const allowed = {
    pumpTruck: {
      tableId: config.bitable.pumpTruckTableId,
      fields: {
        truckModel: config.bitable.fields.pumpTruck.truckModel,
        customerName: config.bitable.fields.pumpTruck.customerName,
      },
    },
    mixerTruck: {
      tableId: config.bitable.mixerTruckTableId,
      fields: {
        customerName: config.bitable.fields.mixerTruck.customerName,
        drivers: config.bitable.fields.mixerTruck.drivers,
      },
    },
  } as const;

  const tableConfig = allowed[table];
  const fieldName = tableConfig?.fields[field as keyof typeof tableConfig.fields];
  if (!tableConfig || !fieldName) {
    throw new HttpError(400, "不支持的字段选项", { table, field });
  }
  return { tableId: tableConfig.tableId, fieldName };
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const normalizedPath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalizedPath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=300",
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1024 * 1024) {
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) return {} as T;

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function ensureConfigured(): void {
  if (missingConfig.length) {
    throw new HttpError(503, "Feishu config is incomplete", { missingConfig });
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.message, ...error.details });
    return;
  }

  if (error instanceof FeishuApiError) {
    sendJson(res, 502, { error: error.message, details: error.details });
    return;
  }

  console.error(error);
  sendJson(res, 500, { error: "Internal server error" });
}

function contentType(filePath: string): string {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  }[extname(filePath)] || "application/octet-stream";
}

class HttpError extends Error {
  status: number;
  details: Record<string, unknown>;

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
