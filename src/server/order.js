/**
 * 记录展示顺序：日期倒序；同一天按车型的字面顺序（码位比较，不做“一 = 1、二 = 2”的智能排序）。
 * 车型为空的记录（搅拌车不记车号）排在当天最后，保持泵车按车号一排排读下去。
 */

function compareLiteral(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function compareRecords(a, b) {
  const dateA = String(a.entry_date || "");
  const dateB = String(b.entry_date || "");
  if (dateA !== dateB) return compareLiteral(dateB, dateA);

  const modelA = String(a.truck_model || "");
  const modelB = String(b.truck_model || "");
  if (modelA !== modelB) {
    if (!modelA) return 1;
    if (!modelB) return -1;
    return compareLiteral(modelA, modelB);
  }

  return (Number(b.id) || 0) - (Number(a.id) || 0);
}

export function sortRecords(rows) {
  return [...rows].sort(compareRecords);
}
