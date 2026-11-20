import assert from "node:assert/strict";
import test from "node:test";

import {
  chineseNumeralToNumber,
  compareTruckModels,
  sortRecords,
  truckModelNumber,
} from "../src/server/order.js";

test("中文数字按数值解析", () => {
  assert.equal(chineseNumeralToNumber("一"), 1);
  assert.equal(chineseNumeralToNumber("两"), 2);
  assert.equal(chineseNumeralToNumber("十"), 10);
  assert.equal(chineseNumeralToNumber("十二"), 12);
  assert.equal(chineseNumeralToNumber("二十"), 20);
  assert.equal(chineseNumeralToNumber("二十三"), 23);
  assert.equal(chineseNumeralToNumber("一百"), 100);
  assert.equal(chineseNumeralToNumber("外"), null);
  assert.equal(chineseNumeralToNumber(""), null);
});

test("从车型里取车号", () => {
  assert.equal(truckModelNumber("一号"), 1);
  assert.equal(truckModelNumber("三号"), 3);
  assert.equal(truckModelNumber("十二号"), 12);
  assert.equal(truckModelNumber("2号"), 2);
  assert.equal(truckModelNumber("52米"), 52);
  assert.equal(truckModelNumber("外借李正"), null);
  assert.equal(truckModelNumber(""), null);
});

test("车型比较：数字序在前，无数字的按字面跟在后面", () => {
  const models = ["三号", "外借李正", "一号", "外借陈骥", "十二号", "二号"];
  assert.deepEqual(models.slice().sort(compareTruckModels), [
    "一号",
    "二号",
    "三号",
    "十二号",
    "外借李正",
    "外借陈骥",
  ]);
});

test("记录排序：日期倒序，同一天 一号→二号→三号，空车型垫底", () => {
  const rows = [
    { id: 1, entry_date: "2026-11-18", truck_model: "三号" },
    { id: 2, entry_date: "2026-11-18", truck_model: "" },
    { id: 3, entry_date: "2026-11-18", truck_model: "一号" },
    { id: 4, entry_date: "2026-11-18", truck_model: "外借李正" },
    { id: 5, entry_date: "2026-11-18", truck_model: "二号" },
    { id: 6, entry_date: "2026-11-17", truck_model: "五号" },
  ];
  assert.deepEqual(
    sortRecords(rows).map((row) => `${row.entry_date} ${row.truck_model || "空"}`),
    ["2026-11-18 一号", "2026-11-18 二号", "2026-11-18 三号", "2026-11-18 外借李正", "2026-11-18 空", "2026-11-17 五号"],
  );
});

test("同车型同一天按 id 倒序（后录的在上）", () => {
  const rows = [
    { id: 10, entry_date: "2026-11-18", truck_model: "一号" },
    { id: 12, entry_date: "2026-11-18", truck_model: "一号" },
    { id: 11, entry_date: "2026-11-18", truck_model: "一号" },
  ];
  assert.deepEqual(
    sortRecords(rows).map((row) => row.id),
    [12, 11, 10],
  );
});
