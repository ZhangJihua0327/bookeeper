/**
 * 农历年（以春节为界）——看板默认统计区间用。
 *
 * 用 ICU 自带的 chinese 日历判定「正月初一」，不手写天文算法，也没有硬编码表：
 * 对 2026-01-01 起逐日检查，第一个 month=1 且 day=1 的日子就是该农历年的春节。
 * 结果按农历年缓存，进程内只算一次。
 */

const FMT = new Intl.DateTimeFormat("en-u-ca-chinese", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

const STEMS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const BRANCHES = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const ZODIAC = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];

const startCache = new Map();

export function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function lunarParts(dateString) {
  let parts;
  try {
    parts = FMT.formatToParts(new Date(`${dateString}T12:00:00+08:00`));
  } catch {
    return null;
  }
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  const year = Number(read("relatedYear"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 返回该日期所在农历年的正月初一（YYYY-MM-DD）；无法判断时返回 null。 */
export function lunarYearStart(dateString) {
  if (!isDateString(dateString)) return null;
  const today = lunarParts(dateString);
  if (!today) return null;

  const year = today.year;
  if (startCache.has(year)) return startCache.get(year);

  let cursor = `${year}-01-01`;
  let found = null;
  for (let step = 0; step < 75; step += 1) {
    const parts = lunarParts(cursor);
    if (parts && parts.month === 1 && parts.day === 1) {
      found = cursor;
      break;
    }
    cursor = addDays(cursor, 1);
  }

  startCache.set(year, found);
  return found;
}

/** 农历年信息：{ year, start, ganzhi, zodiac, label } */
export function lunarYearInfo(dateString) {
  if (!isDateString(dateString)) return null;
  const today = lunarParts(dateString);
  const start = lunarYearStart(dateString);
  if (!today || !start) return null;

  const year = today.year;
  const stem = STEMS[(((year - 4) % 10) + 10) % 10];
  const branch = BRANCHES[(((year - 4) % 12) + 12) % 12];
  const zodiac = ZODIAC[(((year - 4) % 12) + 12) % 12];

  return {
    year,
    start,
    ganzhi: `${stem}${branch}`,
    zodiac,
    label: `农历${stem}${branch}年`,
  };
}
