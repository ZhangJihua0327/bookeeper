/**
 * 记录展示顺序：日期倒序；同一天按车型排序。
 *
 * 车型里的中文数字当数字看：「一号 < 二号 < 三号 < 十号 < 十二号」；
 * 没有数字的（外借某某）按字面排在其后；
 * 没填车型的（搅拌车不记车号）排在当天最后。
 */

const CN_DIGITS: Record<string, number | undefined> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function compareLiteral(a: string, b: string) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 「一」→1、「十」→10、「十二」→12、「二十」→20、「二十三」→23；认不出返回 null */
export function chineseNumeralToNumber(text: unknown) {
  const value = String(text ?? "");
  if (!value) return null;

  let total = 0;
  let digit = 0;
  let seen = false;

  for (const char of value) {
    if (CN_DIGITS[char] !== undefined) {
      digit = CN_DIGITS[char];
      seen = true;
    } else if (char === "十") {
      total += (digit || 1) * 10;
      digit = 0;
      seen = true;
    } else if (char === "百") {
      total += (digit || 1) * 100;
      digit = 0;
      seen = true;
    } else {
      return null;
    }
  }

  return seen ? total + digit : null;
}

/** 车型开头的车号：「一号」→1、「十二号」→12、「2号」→2；「外借李正」→null */
export function truckModelNumber(model: unknown) {
  const text = String(model ?? "").trim();
  const match = /^(\d+|[零一二两三四五六七八九十百]+)/.exec(text);
  if (!match) return null;

  const token = match[1];
  const value = /^\d+$/.test(token) ? Number(token) : chineseNumeralToNumber(token);
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

export function compareTruckModels(a: unknown, b: unknown) {
  const numberA = truckModelNumber(a);
  const numberB = truckModelNumber(b);

  if (numberA !== null && numberB !== null) {
    if (numberA !== numberB) return numberA - numberB;
    return compareLiteral(String(a), String(b));
  }
  if (numberA !== null) return -1;
  if (numberB !== null) return 1;
  return compareLiteral(String(a), String(b));
}

type SortableRecord = { entry_date?: unknown; truck_model?: unknown; id?: unknown };

export function compareRecords(a: SortableRecord, b: SortableRecord) {
  const dateA = String(a.entry_date || "");
  const dateB = String(b.entry_date || "");
  if (dateA !== dateB) return compareLiteral(dateB, dateA);

  const modelA = String(a.truck_model || "").trim();
  const modelB = String(b.truck_model || "").trim();

  if (modelA && modelB) {
    const byModel = compareTruckModels(modelA, modelB);
    if (byModel !== 0) return byModel;
  } else if (modelA) {
    return -1;
  } else if (modelB) {
    return 1;
  }

  return (Number(b.id) || 0) - (Number(a.id) || 0);
}

export function sortRecords<T extends SortableRecord>(rows: readonly T[]) {
  return [...rows].sort(compareRecords);
}
