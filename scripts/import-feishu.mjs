#!/usr/bin/env node
/**
 * 把飞书多维表格里的历史数据同步到本服务的 MySQL。
 *
 * 幂等：以飞书 record_id 作为 source_key 做 upsert，重复执行只会更新、不会重复插入。
 * 保留全部记录（包括方量/客户/日期为空的行），不做任何“看起来像重复”的内容去重。
 *
 * 用法：
 *   node scripts/import-feishu.mjs            # 演练：只统计
 *   node scripts/import-feishu.mjs --apply    # 真正写入
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
      driver: env.PUMP_FIELD_DRIVERS || "驾驶员",
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
      driver: env.MIXER_FIELD_DRIVERS || "驾驶员",
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
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("、");
  if (typeof value === "object") {
    return textValue(value.text ?? value.name ?? value.value ?? "");
  }
  return String(value).trim();
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
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
  const recordId = record.record_id || record.recordId || "";
  return {
    scope,
    source_key: recordId ? `feishu:${recordId}` : null,
    entry_date: dateValue(raw[fields.date]) || null,
    truck_model: textValue(raw[fields.truck_model]).slice(0, 64),
    customer_name: textValue(raw[fields.customer_name]).slice(0, 128),
    volume: numberValue(raw[fields.volume]),
    location: textValue(raw[fields.location]).slice(0, 255),
    remark: textValue(raw[fields.remark]).slice(0, 1000),
    driver: textValue(raw[fields.driver]).slice(0, 255),
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

  const INSERT_SQL = `
    INSERT INTO records
      (scope, entry_date, truck_model, customer_name, volume, location, remark, driver, source_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      entry_date = VALUES(entry_date),
      truck_model = VALUES(truck_model),
      customer_name = VALUES(customer_name),
      volume = VALUES(volume),
      location = VALUES(location),
      remark = VALUES(remark),
      driver = VALUES(driver)`;

  let fetched = 0;
  let written = 0;
  let inserted = 0;
  let updated = 0;
  let blank = 0;
  let noSourceKey = 0;

  for (const table of tables) {
    const records = await listRecords(token, table.tableId);
    fetched += records.length;
    console.log(`[import] ${table.scope}：飞书返回 ${records.length} 条`);

    for (const record of records) {
      const row = mapRecord(table.scope, record, table.fields);
      if (!row.source_key) {
        noSourceKey += 1;
        continue;
      }
      // 跳过整行都空的记录（飞书里偶尔留下的空行），其余一律保留
      const isEmpty =
        !row.entry_date &&
        !row.customer_name &&
        !row.volume &&
        !row.remark &&
        !row.location &&
        !row.truck_model &&
        !row.driver;
      if (isEmpty) {
        blank += 1;
        continue;
      }

      if (APPLY) {
        const [result] = await connection.execute(INSERT_SQL, [
          row.scope,
          row.entry_date,
          row.truck_model,
          row.customer_name,
          row.volume,
          row.location,
          row.remark,
          row.driver,
          row.source_key,
        ]);
        // affectedRows: 1=新增, 2=更新, 0=内容无变化
        if (result.affectedRows === 1) inserted += 1;
        else if (result.affectedRows === 2) updated += 1;
      }
      written += 1;
    }
  }

  // 把记录里出现的客户 / 车型 / 施工地点 / 驾驶员补进字典，录入下拉框才选得到
  if (APPLY) {
    for (const [kind, column] of [
      ["customer", "customer_name"],
      ["truck_model", "truck_model"],
      ["location", "location"],
    ]) {
      await connection.query(
        `INSERT IGNORE INTO dict_items (kind, scope, label, sort_order)
         SELECT DISTINCT ?, 'both', ${column}, 0 FROM records WHERE ${column} IS NOT NULL AND ${column} <> ''`,
        [kind],
      );
    }

    const [driverRows] = await connection.query("SELECT DISTINCT driver FROM records WHERE driver <> ''");
    const drivers = new Set();
    for (const { driver } of driverRows) {
      for (const name of String(driver).split(/[、,，;；\s]+/)) {
        if (name.trim()) drivers.add(name.trim());
      }
    }
    for (const name of drivers) {
      await connection.execute(
        "INSERT IGNORE INTO dict_items (kind, scope, label, sort_order) VALUES ('driver', 'mixer', ?, 0)",
        [name.slice(0, 128)],
      );
    }
    console.log(`[import] 已补齐字典：驾驶员 ${drivers.size} 人`);
  }

  await connection.end();

  console.log(
    `\n[import] ${APPLY ? "已同步" : "演练结果"}：飞书共 ${fetched} 条，可写入 ${written} 条` +
      (APPLY ? `（新增 ${inserted}，更新 ${updated}）` : "") +
      (blank ? `，空白行跳过 ${blank} 条` : "") +
      (noSourceKey ? `，缺 record_id 跳过 ${noSourceKey} 条` : ""),
  );
  if (!APPLY) {
    console.log("[import] 确认无误后加 --apply 真正写入：node scripts/import-feishu.mjs --apply");
  }
}

main().catch((error) => {
  console.error("[import] 失败", error);
  process.exit(1);
});
