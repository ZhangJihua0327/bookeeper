/**
 * 单价索引：客户+车型 → 客户默认 → 车型默认 → 全局默认。
 * 纯函数，便于单测；MySQL store 与内存 store 共用同一套匹配规则。
 */
import type { FormulaValue, PriceMatch, Scope, UnitPrice } from "../shared/types.js";

type PriceRow = Pick<UnitPrice, "scope" | "customer_name" | "truck_model"> & { price: number | string };

export function buildPriceIndex(rows: PriceRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(`${row.scope}|${row.customer_name}|${row.truck_model}`, Number(row.price));
  }

  return {
    size: map.size,
    hasPositive(scope: Scope) {
      for (const [key, price] of map) {
        if (key.startsWith(`${scope}|`) && Number(price) > 0) return true;
      }
      return false;
    },
    resolve(scope: Scope, customerName: FormulaValue, truckModel: FormulaValue): PriceMatch {
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
        const price = map.get(key);
        if (price !== undefined) {
          return { price, missing: false, source: `${c}/${m}` };
        }
      }
      return { price: 0, missing: true, source: "" };
    },
  };
}
