import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";

import { createApp } from "../src/server/app.js";
import { MemoryStore } from "../src/server/memory-store.js";
import { migrateAndSeed } from "../src/server/seed.js";

const config = {
  appPassword: "test-pass",
  sessionSecret: "test-secret-key",
  sessionTtlMs: 60 * 60 * 1000,
  timeZone: "Asia/Shanghai",
};

const silentLog = { info() {}, warn() {}, error() {} };

let server;
let base;
let store;
let cookie = "";

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && cookie) headers.Cookie = cookie;

  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

before(async () => {
  store = new MemoryStore();
  await migrateAndSeed(store, silentLog);
  await store.savePrice({ scope: "pump", customer_name: "*", truck_model: "*", price: 30, note: "默认" });
  await store.savePrice({ scope: "mixer", customer_name: "朱水波", truck_model: "*", price: 25, note: "" });

  server = http.createServer(createApp({ store, config, logger: silentLog }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("健康检查", async () => {
  const res = await request("/api/health", { auth: false });
  assert.equal(res.status, 200);
  assert.equal(res.json.db, "up");
});

test("未登录访问接口返回 401", async () => {
  const res = await request("/api/meta", { auth: false });
  assert.equal(res.status, 401);
  assert.equal(res.json.code, "unauthorized");
});

test("密码错误返回 401，正确则下发 Cookie", async () => {
  const bad = await request("/api/login", { method: "POST", body: { password: "nope" }, auth: false });
  assert.equal(bad.status, 401);

  const good = await request("/api/login", { method: "POST", body: { password: "test-pass" }, auth: false });
  assert.equal(good.status, 200);
  const setCookie = good.headers.get("set-cookie");
  assert.match(setCookie, /bookeeper_session=/);
  cookie = setCookie.split(";")[0];

  const session = await request("/api/session");
  assert.equal(session.json.data.authenticated, true);
});

test("meta 返回两张表的列、字典与公式", async () => {
  const res = await request("/api/meta");
  assert.equal(res.status, 200);
  const data = res.json.data;

  assert.deepEqual(data.scopes.map((scope) => scope.key), ["pump", "mixer"]);
  const pumpFields = data.scopes[0].fields.map((field) => field.label);
  assert.deepEqual(pumpFields, ["日期", "车型", "客户名称", "方量", "施工地点", "备注"]);

  assert.ok(data.variables.includes("方量"));
  assert.ok(data.variables.includes("单价"));
  assert.equal(data.formulas.mixer.volume_formula, "算式(备注)");
  assert.ok(data.dicts.customer.length >= 6);
  assert.equal(data.priceConfigured, true);
});

test("新增泵车记录：按公式算金额", async () => {
  const res = await request("/api/records", {
    method: "POST",
    body: {
      scope: "pump",
      entry_date: "2026-11-15",
      truck_model: "三号",
      customer_name: "贾建",
      volume: 35,
      location: "垫层",
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.volume, 35);
  assert.equal(res.json.data.unit_price, 30);
  assert.equal(res.json.data.amount, 1050);
  assert.equal(res.json.data.scope_label, "泵车");
});

test("搅拌车记录：方量留空时用备注算式自动计算", async () => {
  const res = await request("/api/records", {
    method: "POST",
    body: { scope: "mixer", entry_date: "2026-11-15", customer_name: "朱水波", remark: "12*2+11" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.data.volume, 35);
  assert.equal(res.json.data.unit_price, 25);
  assert.equal(res.json.data.amount, 875);
});

test("校验：缺客户名 / 方量非法 / 日期格式错误", async () => {
  const noCustomer = await request("/api/records", {
    method: "POST",
    body: { scope: "pump", entry_date: "2026-11-15", truck_model: "三号", volume: 10, location: "地坪" },
  });
  assert.equal(noCustomer.status, 400);
  assert.match(noCustomer.json.error, /客户名称不能为空/);

  const badDate = await request("/api/records", {
    method: "POST",
    body: { scope: "pump", entry_date: "2026/11/15", truck_model: "三号", customer_name: "贾建", volume: 10, location: "地坪" },
  });
  assert.equal(badDate.status, 400);
  assert.match(badDate.json.error, /日期格式/);

  const badVolume = await request("/api/records", {
    method: "POST",
    body: { scope: "mixer", entry_date: "2026-11-15", customer_name: "朱水波", remark: "今天休息" },
  });
  assert.equal(badVolume.status, 400);
  assert.match(badVolume.json.error, /方量必须大于 0/);
});

test("看板汇总：方量、金额、分组", async () => {
  const res = await request("/api/dashboard?scope=all&from=2026-11-01&to=2026-11-30");
  assert.equal(res.status, 200);
  const data = res.json.data;

  assert.equal(data.kpi.count, 2);
  assert.equal(data.kpi.volume, 70);
  assert.equal(data.kpi.amount, 1925);
  assert.equal(data.kpi.customers, 2);
  assert.equal(data.groups.scope.length, 2);
  assert.equal(data.groups.customer.find((group) => group.key === "贾建").amount, 1050);
});

test("按客户筛选", async () => {
  const res = await request("/api/records?scope=all&customer=" + encodeURIComponent("贾建"));
  assert.equal(res.json.data.rows.length, 1);
  assert.equal(res.json.data.rows[0].amount, 1050);
});

test("CSV 导出带 BOM 与表头", async () => {
  const response = await fetch(`${base}/api/export.csv?from=2026-11-01&to=2026-11-30`, {
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 200);

  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "应以 UTF-8 BOM 开头，方便 Excel 识别");

  const text = new TextDecoder("utf-8").decode(bytes);
  assert.match(text, /表,日期,车型,客户名称,方量,单价,金额,施工地点,备注/);
  assert.match(text, /泵车,2026-11-15,三号,贾建,35,30,1050/);
});

test("改单价后金额实时变化", async () => {
  await request("/api/prices", {
    method: "POST",
    body: { scope: "pump", customer_name: "贾建", truck_model: "*", price: 32, note: "" },
  });

  const res = await request("/api/records?scope=pump");
  const row = res.json.data.rows[0];
  assert.equal(row.unit_price, 32);
  assert.equal(row.amount, 1120);
});

test("修改与删除记录", async () => {
  const created = await request("/api/records", {
    method: "POST",
    body: { scope: "pump", entry_date: "2026-11-16", truck_model: "一号", customer_name: "贾建", volume: 10, location: "地坪" },
  });
  const id = created.json.data.id;

  const updated = await request(`/api/records/${id}`, {
    method: "PUT",
    body: { scope: "pump", entry_date: "2026-11-16", truck_model: "一号", customer_name: "贾建", volume: 20, location: "地坪" },
  });
  assert.equal(updated.json.data.volume, 20);
  assert.equal(updated.json.data.amount, 640);

  const deleted = await request(`/api/records/${id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);

  const missing = await request(`/api/records/${id}`, { method: "DELETE" });
  assert.equal(missing.status, 404);
});

test("字典增删", async () => {
  const added = await request("/api/dicts", {
    method: "POST",
    body: { kind: "customer", scope: "both", label: "测试客户" },
  });
  assert.equal(added.status, 201);

  const meta = await request("/api/meta");
  assert.ok(meta.json.data.dicts.customer.some((item) => item.label === "测试客户"));

  const removed = await request(`/api/dicts/${added.json.data.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
});

test("公式保存与语法校验", async () => {
  const bad = await request("/api/formulas", {
    method: "PUT",
    body: { scope: "pump", volume_formula: "方量", amount_formula: "方量 *", amount_decimals: 2 },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /语法错误/);

  const good = await request("/api/formulas", {
    method: "PUT",
    body: { scope: "pump", volume_formula: "方量", amount_formula: "方量 * 单价 * 1.1", amount_decimals: 2 },
  });
  assert.equal(good.status, 200);

  const rows = await request("/api/records?scope=pump");
  assert.equal(rows.json.data.rows[0].amount, 1232);

  // 复原
  await request("/api/formulas", {
    method: "PUT",
    body: { scope: "pump", volume_formula: "方量", amount_formula: "方量 * 单价", amount_decimals: 2 },
  });
});

test("公式试算接口", async () => {
  const res = await request("/api/evaluate", {
    method: "POST",
    body: {
      scope: "mixer",
      expression: "算式(备注) * 单价",
      entry_date: "2026-11-20",
      customer_name: "朱水波",
      remark: "12*2+11",
    },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.ok, true);
  assert.equal(res.json.data.value, 875);
  assert.equal(res.json.data.unitPrice, 25);
});

test("静态页面可访问", async () => {
  const res = await request("/", { auth: false });
  assert.equal(res.status, 200);
  assert.match(res.text, /Bookeeper/);
});

test("阻断路径穿越", async () => {
  const res = await request("/%2e%2e/%2e%2e/package.json", { auth: false });
  assert.ok([403, 404].includes(res.status));
});

test("CSV 列出两张表的列，不含驾驶员列", async () => {
  const response = await fetch(`${base}/api/export.csv?from=2026-10-01&to=2026-10-31`, {
    headers: { Cookie: cookie },
  });
  const text = new TextDecoder("utf-8").decode(new Uint8Array(await response.arrayBuffer()));
  assert.match(text, /表,日期,车型,客户名称,方量,单价,金额,施工地点,备注/);
  assert.equal(text.includes("驾驶员"), false);
});

test("未填日期的存量记录不会让看板报错", async () => {
  store.records.push({
    id: 90001,
    scope: "pump",
    entry_date: "",
    truck_model: "二号",
    customer_name: "高飞",
    volume: 51,
    location: "附房楼面",
    remark: "",
    driver: "",
    unit_price_override: null,
  });

  const all = await request("/api/dashboard");
  assert.equal(all.status, 200);
  assert.ok(all.json.data.groups.date.some((group) => group.key === "未填日期"));

  const ranged = await request("/api/dashboard?from=2026-11-01&to=2026-11-30");
  assert.equal(ranged.status, 200);
  assert.equal(ranged.json.data.rows.some((row) => row.customer_name === "高飞"), false);
});
