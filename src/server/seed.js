import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "..", "db", "schema.sql");

const SEED_CUSTOMERS = ["贾建", "朱水波", "汤建明", "徐功银", "新联搅拌站", "久拓"];
const SEED_MODELS = ["一号", "二号", "三号"];
const SEED_LOCATIONS = ["垫层", "地坪", "高小兵", "500", "新姚楼面"];

export const DEFAULT_FORMULAS = {
  pump: { volume_formula: "方量", amount_formula: "方量 * 单价", amount_decimals: 2 },
  mixer: { volume_formula: "算式(备注)", amount_formula: "方量 * 单价", amount_decimals: 2 },
};

export function readSchema() {
  return readFileSync(schemaPath, "utf8");
}

/**
 * 老库升级：给已存在的 records 表补列 / 放宽约束。
 * 全部幂等，每次启动跑一遍也不会重复执行。
 */
async function runMigrations(store, log) {
  if (!store.ensureColumn) return;

  const applied = [];
  if (await store.ensureColumn("records", "driver", "VARCHAR(255) NOT NULL DEFAULT '' AFTER remark")) {
    applied.push("records.driver");
  }
  if (await store.ensureColumn("records", "source_key", "VARCHAR(64) NULL AFTER driver")) {
    applied.push("records.source_key");
  }
  if (await store.ensureIndex("records", "uk_source_key", "UNIQUE KEY uk_source_key (source_key)")) {
    applied.push("records.uk_source_key");
  }
  if (!(await store.isNullable("records", "entry_date"))) {
    await store.execute("ALTER TABLE records MODIFY COLUMN entry_date DATE NULL");
    applied.push("records.entry_date -> NULL");
  }
  if (applied.length) {
    log.info?.(`[migrate] ${applied.join(", ")}`);
  }
}

export async function migrateAndSeed(store, log = console) {
  await store.migrate(readSchema());
  await runMigrations(store, log);

  const existingFormulas = await store.getFormulas();
  for (const [scope, formulas] of Object.entries(DEFAULT_FORMULAS)) {
    if (!existingFormulas[scope]) {
      await store.saveFormula({ scope, ...formulas });
      log.info?.(`[seed] 初始化 ${scope} 公式`);
    }
  }

  const dicts = await store.listDicts();
  if (!dicts.length) {
    await store.seedDicts([
      ...SEED_CUSTOMERS.map((label, index) => ({ kind: "customer", scope: "both", label, sort_order: index })),
      ...SEED_MODELS.map((label, index) => ({ kind: "truck_model", scope: "both", label, sort_order: index })),
      ...SEED_LOCATIONS.map((label, index) => ({ kind: "location", scope: "both", label, sort_order: index })),
    ]);
    log.info?.("[seed] 初始化客户 / 车型 / 施工地点字典");
  }

  const prices = await store.listPrices();
  if (!prices.length) {
    for (const scope of ["pump", "mixer"]) {
      await store.savePrice({
        scope,
        customer_name: "*",
        truck_model: "*",
        price: 0,
        note: "默认单价，请按客户或车型设置实际单价",
      });
    }
    log.info?.("[seed] 初始化默认单价（0 元，请到配置页修改）");
  }
}
