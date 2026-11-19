/**
 * 单价索引：客户+车型 → 客户默认 → 车型默认 → 全局默认。
 * 纯函数，便于单测；MySQL store 与内存 store 共用同一套匹配规则。
 */
export function buildPriceIndex(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.scope}|${row.customer_name}|${row.truck_model}`, Number(row.price));
  }

  return {
    size: map.size,
    hasPositive(scope) {
      for (const [key, price] of map) {
        if (key.startsWith(`${scope}|`) && Number(price) > 0) return true;
      }
      return false;
    },
    resolve(scope, customerName, truckModel) {
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
        if (map.has(key)) {
          return { price: map.get(key), missing: false, source: `${c}/${m}` };
        }
      }
      return { price: 0, missing: true, source: "" };
    },
  };
}
