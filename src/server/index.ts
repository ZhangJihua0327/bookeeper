import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
  validateMixerTruck,
  validatePumpTruck,
  type MixerTruckInput,
  type PumpTruckInput,
} from "./report.js";

interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
}

interface CreatePumpTruckInput extends PumpTruckInput {
  addMissingOptions?: boolean;
}

interface CreateMixerTruckInput extends MixerTruckInput {
  addMissingOptions?: boolean;
}

interface AddOptionInput {
  table: "pumpTruck" | "mixerTruck";
  field: string;
  value: string;
}

type RouteHandler = (ctx: RouteContext) => Promise<void>;

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const missingConfig = getMissingConfig();

const feishu = new FeishuBitableClient({
  appId: config.feishu.appId,
  appSecret: config.feishu.appSecret,
  appToken: config.bitable.appToken,
  baseUrl: config.feishu.baseUrl,
});

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
  sendJson(res, 200, await loadOptionSets());
}

async function handleAddOption({ req, res }: RouteContext): Promise<void> {
  ensureConfigured();
  const input = await readJson<AddOptionInput>(req);
  const target = optionTarget(input.table, input.field);
  const result = await feishu.addFieldOption(target.tableId, target.fieldName, input.value || "");
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

  const addedOptions = input.addMissingOptions === false ? [] : await Promise.all([
    feishu.ensureFieldOptions(config.bitable.pumpTruckTableId, config.bitable.fields.pumpTruck.truckModel, [input.truckModel]),
    feishu.ensureFieldOptions(config.bitable.pumpTruckTableId, config.bitable.fields.pumpTruck.customerName, [input.customerName]),
  ]).then((items) => items.flat());

  const fields = makePumpTruckFields(input, config.bitable.fields.pumpTruck);
  const record = await feishu.createRecord(config.bitable.pumpTruckTableId, fields);
  sendJson(res, 201, { record, fields, addedOptions });
}

async function handleCreateMixerTruck({ req, res }: RouteContext): Promise<void> {
  ensureConfigured();
  const input = await readJson<CreateMixerTruckInput>(req);
  const errors = validateMixerTruck(input);
  if (errors.length) {
    sendJson(res, 400, { error: "搅拌车表单校验失败", details: errors });
    return;
  }

  const addedOptions = input.addMissingOptions === false ? [] : await Promise.all([
    feishu.ensureFieldOptions(config.bitable.mixerTruckTableId, config.bitable.fields.mixerTruck.customerName, [input.customerName]),
    feishu.ensureFieldOptions(config.bitable.mixerTruckTableId, config.bitable.fields.mixerTruck.drivers, input.drivers),
  ]).then((items) => items.flat());

  const fields = makeMixerTruckFields(input, config.bitable.fields.mixerTruck);
  const record = await feishu.createRecord(config.bitable.mixerTruckTableId, fields);
  sendJson(res, 201, { record, fields, addedOptions });
}

async function handleYesterdayReport({ res, url }: RouteContext): Promise<void> {
  ensureConfigured();
  const date = url.searchParams.get("date") || getYesterdayDate(config.timeZone);
  const [pumpRecords, mixerRecords] = await Promise.all([
    feishu.listRecords(config.bitable.pumpTruckTableId),
    feishu.listRecords(config.bitable.mixerTruckTableId),
  ]);

  const report = buildYesterdayReport({
    date,
    pumpRecords,
    mixerRecords,
    fields: config.bitable.fields,
    timeZone: config.timeZone,
  });

  sendJson(res, 200, report);
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

async function loadOptionSets() {
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
