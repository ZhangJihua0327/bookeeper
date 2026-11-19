#!/usr/bin/env node
/**
 * 一次性把飞书多维表格里的历史数据导入本服务的 MySQL。
 *
 * 默认是“演练模式”，只统计不写入；确认无误后加 --apply 真正导入。
 *
 * 用法：
 *   docker compose exec bookeeper node scripts/import-feishu.mjs            # 演练
 *   docker compose exec bookeeper node scripts/import-feishu.mjs --apply    # 导入
 *
 * 需要的环境变量见 .env.example 里 FEISHU_* / BITABLE_* / *_FIELD_* 段。
 */

import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");

const env = process.env;
const timeZone = env.TIME_ZONE || "Asia/Shanghai";

const feishu = {
  appId: env.FEISHU_APP_ID || "",
  appSecret: env.FEISHU_APP_SECRET || "",
  baseUrl: (env.FEISHU_BASE_URL || "https://open.feishu.cn").replace(/\/$/, ""),
  appToken: env.BITABLE_APP_TOKEN || "",
};

const tables = [
  {
    scope: "pump",
    tableId: env.PUMP_TRUCK_TABLE_ID || "",
    fields: {
      date: env.PUMP_FIELD_DATE || "日期",
      truck_model: env.PUMP_FIELD_TRUCK_MODEL || "车型",
      customer_name: env.PUMP_FIELD_CUSTOMER_NAME || "客户名称",
      volume: env.PUMP_FIELD_VOLUME || "方量",
      location: env.PUMP_FIELD_LOCATION || "施工地点",
      remark: env.PUMP_FIELD_REMARK || "备注",
    },
  },
  {
    scope: "mixer",
    tableId: env.MIXER_TRUCK_TABLE_ID || "",
    fields: {
      date: env.MIXER_FIELD_DATE || "日期",
      customer_name: env.MIXER_FIELD_CUSTOMER_NAME || "客户名称",
      volume: env.MIXER_FIELD_VOLUME || "方量",
      remark: env.MIXER_FIELD_REMARK || "备注",
      truck_model: env.MIXER_FIELD_TRUCK_MODEL || "车型",
      location: env.MIXER_FIELD_LOCATION || "施工地点",
    },
  },
];

function fail(message) {
  console.error(`[import] ${message}`);
  process.exit(1);
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("");
  if (typeof value === "object") {
    return textValue(value.text ?? value.name ?? value.value ?? "");
  }
  return String(value).trim();
}

function numberValue(value) {
  if (typeof value === "number") return value;
  const parsed = Number(textValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value) {
  if (typeof value === "number") {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  }
  const text = textValue(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{13}$/.test(text)) return dateValue(Number(text));
  return "";
}

async function getToken() {
  const response = await fetch(`${feishu.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: feishu.appId, app_secret: feishu.appSecret }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.tenant_access_token) {
    fail(`获取 tenant_access_token 失败：${body.msg || response.status}`);
  }
  return body.tenant_access_token;
}

async function listRecords(token, tableId) {
  const records = [];
  let pageToken = "";

  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);

    const response = await fetch(
      `${feishu.baseUrl}/open-apis/bitable/v1/apps/${encodeURIComponent(feishu.appToken)}/tables/${encodeURIComponent(tableId)}/records?${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || (body.code !== undefined && body.code !== 0)) {
      fail(`读取表 ${tableId} 失败：${body.msg || response.status}`);
    }

    records.push(...(body.data?.items || []));
    if (!body.data?.has_more || !body.data?.page_token) break;
    pageToken = body.data.page_token;
  }

  return records;
}

function mapRecord(scope, record, fields) {
  const raw = record.fields || {};
  const volume = numberValue(raw[fields.volume]);
  return {
    scope,
    entry_date: dateValue(raw[fields.date]),
    truck_model: textValue(raw[fields.truck_model]),
    customer_name: textValue(raw[fields.customer_name]),
    volume,
    location: textValue(raw[fields.location]),
    remark: textValue(raw[fields.remark]),
    unit_price_override: null,
  };
}

async function main() {
  const missing = [];
  if (!feishu.appId) missing.push("FEISHU_APP_ID");
  if (!feishu.appSecret) missing.push("FEISHU_APP_SECRET");
  if (!feishu.appToken) missing.push("BITABLE_APP_TOKEN");
  for (const table of tables) {
    if (!table.tableId) missing.push(table.scope === "pump" ? "PUMP_TRUCK_TABLE_ID" : "MIXER_TRUCK_TABLE_ID");
  }
  if (missing.length) fail(`缺少环境变量：${missing.join("、")}`);

  const token = await getToken();
  const connection = await mysql.createConnection({
    host: env.DB_HOST || "127.0.0.1",
    port: Number(env.DB_PORT || 3306),
    database: env.DB_NAME || "bookeeper",
    user: env.DB_USER || "bookeeper",
    password: env.DB_PASSWORD || "",
    charset: "utf8mb4",
    dateStrings: true,
  });

  const [existing] = await connection.query(
    "SELECT scope, entry_date, customer_name, volume, remark FROM records",
  );
  const seen = new Set(
    existing.map(
      (row) =>
        `${row.scope}|${String(row.entry_date).slice(0, 10)}|${row.customer_name}|${Number(row.volume)}|${row.remark || ""}`,
    ),
  );

  let inserted = 0;
  let skipped = 0;
  let invalid = 0;

  for (const table of tables) {
    const records = await listRecords(token, table.tableId);
    console.log(`\n[import] ${table.scope}：飞书返回 ${records.length} 条`);

    for (const record of records) {
      const row = mapRecord(table.scope, record, table.fields);
      if (!row.entry_date || !row.customer_name || !(row.volume > 0)) {
        invalid += 1;
        continue;
      }

      const key = `${row.scope}|${row.entry_date}|${row.customer_name}|${row.volume}|${row.remark}`;
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);

      if (APPLY) {
        await connection.execute(
          `INSERT INTO records (scope, entry_date, truck_model, customer_name, volume, location, remark, unit_price_override)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
          [row.scope, row.entry_date, row.truck_model, row.customer_name, row.volume, row.location, row.remark],
        );
      }
      inserted += 1;
    }
  }

  await connection.end();

  console.log(
    `\n[import] ${APPLY ? "已导入" : "演练结果"}：可写入 ${inserted} 条，重复跳过 ${skipped} 条，字段不完整忽略 ${invalid} 条`,
  );
  if (!APPLY) {
    console.log("[import] 确认无误后加 --apply 真正写入：node scripts/import-feishu.mjs --apply");
  }
}

main().catch((error) => {
  console.error("[import] 失败", error);
  process.exit(1);
});
