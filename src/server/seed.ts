import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { DictInput, Formulas } from "../shared/types.js";
import type { LedgerStore } from "./ledger-store.js";
import { SCOPE_KEYS } from "./scopes.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "..", "db", "schema.sql");

const SEED_CUSTOMERS = ["贾建", "朱水波", "汤建明", "徐功银", "新联搅拌站", "久拓"];
const SEED_MODELS = ["一号", "二号", "三号"];

export const DEFAULT_FORMULAS: Formulas = {
  // 泵车：起步价 800，20 元/方取高；蒲发混凝土 2026-09-01 起起步价降为 600
  pump: {
    volume_formula: "方量",
    amount_formula:
      'if(客户名称 == "蒲发混凝土" && 日期 >= "2026-09-01", max(600, 20 * 方量), max(800, 20 * 方量))',
    amount_decimals: 2,
  },
  // 搅拌车：30 元/方
  mixer: {
    volume_formula: "算式(备注)",
    amount_formula: "30 * 方量",
    amount_decimals: 2,
  },
};

export function readSchema() {
  return readFileSync(schemaPath, "utf8");
}

/**
 * 幂等建表 + 首次写入字典/公式/默认单价。
 * 默认单价写 0，并在配置页提示，避免用编造的价格算出“看着像真的”金额。
 */
export async function migrateAndSeed(store: LedgerStore, log: Pick<Console, "info"> = console) {
  await store.migrate(readSchema());

  const existingFormulas = await store.getFormulas();
  for (const scope of SCOPE_KEYS) {
    if (!existingFormulas[scope]) {
      await store.saveFormula({ scope, ...DEFAULT_FORMULAS[scope] });
      log.info?.(`[seed] 初始化 ${scope} 公式`);
    }
  }

  const dicts = await store.listDicts();
  if (!dicts.length) {
    await store.seedDicts([
      ...SEED_CUSTOMERS.map<DictInput>((label, index) => ({ kind: "customer", scope: "both", label, sort_order: index })),
      ...SEED_MODELS.map<DictInput>((label, index) => ({ kind: "truck_model", scope: "both", label, sort_order: index })),
    ]);
    log.info?.("[seed] 初始化客户 / 车型字典");
  }

  const prices = await store.listPrices();
  if (!prices.length) {
    for (const scope of SCOPE_KEYS) {
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
