import assert from "node:assert/strict";
import test from "node:test";

import { lunarYearInfo, lunarYearStart } from "../src/server/lunar.js";

test("农历年从春节当天开始", () => {
  assert.equal(lunarYearStart("2026-11-20"), "2026-02-17");
  assert.equal(lunarYearStart("2026-02-17"), "2026-02-17");
  assert.equal(lunarYearStart("2025-06-01"), "2025-01-29");
  assert.equal(lunarYearStart("2024-02-10"), "2024-02-10");
});

test("春节前仍属于上一个农历年", () => {
  assert.equal(lunarYearStart("2026-02-16"), "2025-01-29"); // 除夕
  assert.equal(lunarYearStart("2026-01-10"), "2025-01-29");
  assert.equal(lunarYearStart("2024-02-09"), "2023-01-22");
});

test("干支与生肖按农历年推算", () => {
  assert.deepEqual(lunarYearInfo("2026-11-20"), {
    year: 2026,
    start: "2026-02-17",
    ganzhi: "丙午",
    zodiac: "马",
    label: "农历丙午年",
  });
  assert.equal(lunarYearInfo("2025-03-01")?.ganzhi, "乙巳");
  assert.equal(lunarYearInfo("2025-03-01")?.zodiac, "蛇");
  assert.equal(lunarYearInfo("2024-05-01")?.ganzhi, "甲辰");
  assert.equal(lunarYearInfo("2024-05-01")?.zodiac, "龙");
});

test("非法输入返回 null", () => {
  assert.equal(lunarYearStart(""), null);
  assert.equal(lunarYearStart("not-a-date"), null);
  assert.equal(lunarYearInfo("2026-13-40"), null);
});
