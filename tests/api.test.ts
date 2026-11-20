import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";

import type {
  DashboardData, DecoratedRecord, DictOption, EvaluationData, MetaData, RecordsData, SessionData,
} from "../src/shared/types.js";
import { createApp } from "../src/server/app.js";
import { MemoryStore } from "../src/server/memory-store.js";
import { migrateAndSeed } from "../src/server/seed.js";

const config = {
  appPassword: "test-pass",
  sessionSecret: "test-secret-key",
  sessionTtlMs: 60 * 60 * 1000,
  timeZone: "Asia/Shanghai",
  dashscope: { apiKey: "", model: "qwen3-vl-plus", timeoutMs: 1000 },
};

const silentLog = { info() {}, warn() {}, error() {} };

let server: http.Server;
let base: string;
const store = new MemoryStore();
let cookie = "";

async function request<T = unknown>(path: string, { method = "GET", body, auth = true }: {
  method?: string;
  body?: unknown;
  auth?: boolean;
} = {}) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && cookie) headers.Cookie = cookie;

  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: { ok?: boolean; data?: T; db?: string; code?: string; error?: string } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

before(async () => {
  await migrateAndSeed(store, silentLog);
  // 金额相关的用例统一用最简单的 方量 * 单价，避免和业务默认公式耦合
  await store.saveFormula({ scope: "pump", volume_formula: "方量", amount_formula: "方量 * 单价", amount_decimals: 2 });
  await store.saveFormula({ scope: "mixer", volume_formula: "算式(备注)", amount_formula: "方量 * 单价", amount_decimals: 2 });
  await store.savePrice({ scope: "pump", customer_name: "*", truck_model: "*", price: 30, note: "默认" });
  await store.savePrice({ scope: "mixer", customer_name: "朱水波", truck_model: "*", price: 25, note: "" });

  server = http.createServer(createApp({ store, config, logger: silentLog }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("健康检查", async () => {
  const res = await request("/api/health", { auth: false });
  assert.equal(res.status, 200);
  assert.equal(res.json?.db, "up");
});

test("未登录访问接口返回 401", async () => {
  const res = await request("/api/meta", { auth: false });
  assert.equal(res.status, 401);
  assert.equal(res.json?.code, "unauthorized");
});

test("密码错误返回 401，正确则下发 Cookie", async () => {
  const bad = await request("/api/login", { method: "POST", body: { password: "nope" }, auth: false });
  assert.equal(bad.status, 401);

  const good = await request("/api/login", { method: "POST", body: { password: "test-pass" }, auth: false });
  assert.equal(good.status, 200);
  const setCookie = good.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.match(setCookie, /bookeeper_session=/);
  cookie = setCookie.split(";")[0];

  const session = await request<SessionData>("/api/session");
  assert.equal(session.json?.data?.authenticated, true);
});

test("meta 返回两张表的列、字典与公式", async () => {
  const res = await request<MetaData>("/api/meta");
  assert.equal(res.status, 200);
  const data = res.json?.data;
  assert.ok(data);

  assert.deepEqual(data.scopes.map((scope) => scope.key), ["pump", "mixer"]);
  const pumpFields = data.scopes[0].fields.map((field) => field.label);
  assert.deepEqual(pumpFields, ["日期", "车型", "客户名称", "方量", "备注"]);

  assert.ok(data.variables.includes("方量"));
  assert.ok(data.variables.includes("单价"));
  assert.equal(data.formulas.mixer.volume_formula, "算式(备注)");
  assert.ok(data.dicts.customer.length >= 6);
  assert.equal(data.priceConfigured, true);
  // 看板默认按农历年统计，区间起点由服务端给出
  assert.ok(data.lunar);
  assert.match(data.lunar.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(data.lunar.year, Number(data.lunar.start.slice(0, 4)));
  assert.match(data.lunar.label, /^农历[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]年$/);
  assert.ok(data.lunar.start <= data.today);
});

test("新增泵车记录：按公式算金额", async () => {
  const res = await request<DecoratedRecord>("/api/records", {
    method: "POST",
    body: {
      scope: "pump",
      entry_date: "2026-11-15",
      truck_model: "三号",
      customer_name: "贾建",
      volume: 35,
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json?.data?.volume, 35);
  assert.equal(res.json?.data?.unit_price, 30);
  assert.equal(res.json?.data?.amount, 1050);
  assert.equal(res.json?.data?.scope_label, "泵车");
});

test("搅拌车记录：方量留空时用备注算式自动计算", async () => {
  const res = await request<DecoratedRecord>("/api/records", {
    method: "POST",
    body: { scope: "mixer", entry_date: "2026-11-15", customer_name: "朱水波", remark: "12*2+11" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json?.data?.volume, 35);
  assert.equal(res.json?.data?.unit_price, 25);
  assert.equal(res.json?.data?.amount, 875);
});

test("校验：缺客户名 / 方量非法 / 日期格式错误", async () => {
  const noCustomer = await request<DecoratedRecord>("/api/records", {
    method: "POST",
    body: { scope: "pump", entry_date: "2026-11-15", truck_model: "三号", volume: 10 },
  });
  assert.equal(noCustomer.status, 400);
  assert.match(noCustomer.json?.error ?? "", /客户名称不能为空/);

  const badDate = await request<DecoratedRecord>("/api/records", {
    method: "POST",
    body: { scope: "pump", entry_date: "2026/11/15", truck_model: "三号", customer_name: "贾建", volume: 10 },
  });
  assert.equal(badDate.status, 400);
  assert.match(badDate.json?.error ?? "", /日期格式/);

  const badVolume = await request<DecoratedRecord>("/api/records", {
    method: "POST",
    body: { scope: "mixer", entry_date: "2026-11-15", customer_name: "朱水波", remark: "今天休息" },
  });
  assert.equal(badVolume.status, 400);
  assert.match(badVolume.json?.error ?? "", /方量必须大于 0/);
});

test("看板汇总：方量、金额、分组", async () => {
  const res = await request<DashboardData>("/api/dashboard?scope=all&from=2026-11-01&to=2026-11-30");
  assert.equal(res.status, 200);
  const data = res.json?.data;
  assert.ok(data);

  assert.equal(data.kpi.count, 2);
  assert.equal(data.kpi.volume, 70);
  assert.equal(data.kpi.amount, 1925);
  assert.equal(data.kpi.customers, 2);
  assert.equal(data.groups.scope.length, 2);
  assert.equal(data.groups.customer.find((group) => group.key === "贾建")?.amount, 1050);

  assert.equal(data.scopes.pump.count, 1);
  assert.equal(data.scopes.pump.volume, 35);
  assert.equal(data.scopes.pump.amount, 1050);
  assert.equal(data.scopes.mixer.count, 1);
  assert.equal(data.scopes.mixer.amount, 875);
});

test("按客户筛选", async () => {
  const res = await request<RecordsData>("/api/records?scope=all&customer=" + encodeURIComponent("贾建"));
  assert.equal(res.json?.data?.rows.length, 1);
  assert.equal(res.json?.data?.rows[0].amount, 1050);
});

test("CSV 导出带 BOM 与表头", async () => {
  const response = await fetch(`${base}/api/export.csv?from=2026-11-01&to=2026-11-30`, {
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 200);

  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "应以 UTF-8 BOM 开头，方便 Excel 识别");

  const text = new TextDecoder("utf-8").decode(bytes);
  assert.match(text, /表,日期,车型,客户名称,方量,单价,金额,备注/);
  assert.match(text, /泵车,2026-11-15,三号,贾建,35,30,1050/);
});

test("改单价后金额实时变化", async () => {
  await request("/api/prices", {
    method: "POST",
    body: { scope: "pump", customer_name: "贾建", truck_model: "*", price: 32, note: "" },
  });

  const res = await request<RecordsData>("/api/records?scope=pump");
  const row = res.json?.data?.rows[0];
  assert.ok(row);
  assert.equal(row.unit_price, 32);
  assert.equal(row.amount, 1120);
});

test("修改与删除记录", async () => {
  const created = await request<DecoratedRecord>("/api/records", {
    method: "POST",
    body: { scope: "pump", entry_date: "2026-11-16", truck_model: "一号", customer_name: "贾建", volume: 10 },
  });
  const id = created.json?.data?.id;
  assert.ok(id);

  const updated = await request<DecoratedRecord>(`/api/records/${id}`, {
    method: "PUT",
    body: { scope: "pump", entry_date: "2026-11-16", truck_model: "一号", customer_name: "贾建", volume: 20 },
  });
  assert.equal(updated.json?.data?.volume, 20);
  assert.equal(updated.json?.data?.amount, 640);

  const deleted = await request(`/api/records/${id}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);

  const missing = await request(`/api/records/${id}`, { method: "DELETE" });
  assert.equal(missing.status, 404);
});

test("字典增删", async () => {
  const added = await request<Pick<DictOption, "id">>("/api/dicts", {
    method: "POST",
    body: { kind: "customer", scope: "both", label: "测试客户" },
  });
  assert.equal(added.status, 201);

  const meta = await request<MetaData>("/api/meta");
  assert.ok(meta.json?.data?.dicts.customer.some((item) => item.label === "测试客户"));

  const removed = await request(`/api/dicts/${added.json?.data?.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
});

test("公式保存与语法校验", async () => {
  const bad = await request("/api/formulas", {
    method: "PUT",
    body: { scope: "pump", volume_formula: "方量", amount_formula: "方量 *", amount_decimals: 2 },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json?.error ?? "", /语法错误/);

  const good = await request("/api/formulas", {
    method: "PUT",
    body: { scope: "pump", volume_formula: "方量", amount_formula: "方量 * 单价 * 1.1", amount_decimals: 2 },
  });
  assert.equal(good.status, 200);

  const rows = await request<RecordsData>("/api/records?scope=pump");
  assert.equal(rows.json?.data?.rows[0].amount, 1232);

  // 复原
  await request("/api/formulas", {
    method: "PUT",
    body: { scope: "pump", volume_formula: "方量", amount_formula: "方量 * 单价", amount_decimals: 2 },
  });
});

test("公式试算接口", async () => {
  const res = await request<EvaluationData>("/api/evaluate", {
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
  assert.equal(res.json?.data?.ok, true);
  assert.equal(res.json?.data?.value, 875);
  assert.equal(res.json?.data?.unitPrice, 25);
});

test("静态页面、编译后的脚本和样式可访问", async () => {
  const res = await request("/", { auth: false });
  assert.equal(res.status, 200);
  assert.match(res.text, /Bookeeper/);
  assert.match(res.text, /src="\/app\.js"/);

  const script = await request("/app.js", { auth: false });
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);
  assert.match(script.text, /function boot\(/);

  const stylesheet = await request("/styles.css", { auth: false });
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get("content-type") ?? "", /text\/css/);
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
  assert.match(text, /备注,计价方式/);
  assert.equal(text.includes("驾驶员"), false);
});

test("金额可手填；填了以手填为准，清空则回到公式", async () => {
  const created = await request<DecoratedRecord>("/api/records", {
    method: "POST",
    body: {
      scope: "pump",
      entry_date: "2026-10-20",
      truck_model: "一号",
      customer_name: "贾建",
      volume: 10,
      amount_override: 999,
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json?.data?.amount, 999);
  assert.equal(created.json?.data?.amount_source, "manual");

  const auto = await request<DecoratedRecord>("/api/records", {
    method: "POST",
    body: { scope: "pump", entry_date: "2026-10-20", truck_model: "一号", customer_name: "贾建", volume: 10 },
  });
  assert.equal(auto.json?.data?.amount_source, "formula");
  assert.equal(auto.json?.data?.amount, created.json?.data?.amount_formula_value);

  const cleared = await request<DecoratedRecord>(`/api/records/${created.json?.data?.id}`, {
    method: "PUT",
    body: { scope: "pump", entry_date: "2026-10-20", truck_model: "一号", customer_name: "贾建", volume: 10 },
  });
  assert.equal(cleared.json?.data?.amount, auto.json?.data?.amount);
  assert.equal(cleared.json?.data?.amount_source, "formula");
});

test("未填日期的存量记录不会让看板报错", async () => {
  await store.createRecord({
    scope: "pump",
    entry_date: "",
    truck_model: "二号",
    customer_name: "高飞",
    volume: 51,
    remark: "",
    amount_override: null,
  });

  const all = await request<DashboardData>("/api/dashboard");
  assert.equal(all.status, 200);
  assert.ok(all.json?.data?.groups.date.some((group) => group.key === "未填日期"));

  const ranged = await request<DashboardData>("/api/dashboard?from=2026-11-01&to=2026-11-30");
  assert.equal(ranged.status, 200);
  assert.equal(ranged.json?.data?.rows.some((row) => row.customer_name === "高飞"), false);
});

test("同一天按车型字面顺序排列，没填车型的排当天最后", async () => {
  const date = "2026-10-05";
  for (const model of ["三号", "一号", "二号"]) {
    const res = await request<DecoratedRecord>("/api/records", {
      method: "POST",
      body: { scope: "pump", entry_date: date, truck_model: model, customer_name: "排序测试", volume: 10 },
    });
    assert.equal(res.status, 201);
  }
  const mixer = await request<DecoratedRecord>("/api/records", {
    method: "POST",
    body: { scope: "mixer", entry_date: date, customer_name: "排序测试", volume: 12, remark: "12" },
  });
  assert.equal(mixer.status, 201);

  const list = await request<RecordsData>(`/api/records?from=${date}&to=${date}`);
  const models = list.json?.data?.rows.map((row) => row.truck_model || "");
  // 中文数字当数字看：一号 < 二号 < 三号，搅拌车不填车型所以垫底
  assert.deepEqual(models, ["一号", "二号", "三号", ""]);

  const board = await request<DashboardData>(`/api/dashboard?from=${date}&to=${date}`);
  assert.deepEqual(
    board.json?.data?.rows.map((row) => row.truck_model || ""),
    ["一号", "二号", "三号", ""],
  );
});
