import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAmount,
  evaluateRemarkExpression,
  evaluateFormula,
  parseFormula,
  tokenize,
} from "../src/server/formula.js";
import { buildPriceIndex } from "../src/server/prices.js";

const priceIndex = buildPriceIndex([
  { scope: "pump", customer_name: "贾建", truck_model: "*", price: 30 },
  { scope: "pump", customer_name: "朱水波", truck_model: "*", price: 28 },
  { scope: "pump", customer_name: "*", truck_model: "二号", price: 26 },
  { scope: "pump", customer_name: "*", truck_model: "*", price: 20 },
]);

const priceLookup = (customer, model) => priceIndex.resolve("pump", customer, model);

const values = {
  日期: "2026-11-15",
  车型: "二号",
  客户名称: "贾建",
  方量: 35,
  施工地点: "垫层",
  备注: "12*2+11",
  单价: 30,
};

test("tokenize 支持全角符号与中文列名", () => {
  const tokens = tokenize("方量×2＋10");
  assert.deepEqual(
    tokens.map((token) => [token.type, token.value]),
    [
      ["ident", "方量"],
      ["op", "*"],
      ["number", 2],
      ["op", "+"],
      ["number", 10],
      ["end", ""],
    ],
  );
});

test("基本四则运算与优先级", () => {
  assert.equal(computeAmount("方量 * 单价", values, priceLookup).amount, 1050);
  assert.equal(computeAmount("(方量 + 5) * 2", values, priceLookup).amount, 80);
  assert.equal(computeAmount("方量 / 2 - 1", values, priceLookup).amount, 16.5);
});

test("备注算式解析", () => {
  assert.equal(evaluateRemarkExpression("12*2+11").value, 35);
  assert.equal(evaluateRemarkExpression("9*6").value, 54);
  assert.equal(evaluateRemarkExpression("8").value, 8);
  assert.equal(evaluateRemarkExpression("9+8").value, 17);
  // 空格视为相加：12*2 10*2+9+3.5 = 24 + 20 + 9 + 3.5
  assert.equal(evaluateRemarkExpression("12*2 10*2+9+3.5").value, 56.5);
  assert.equal(evaluateRemarkExpression("12×2＋11").value, 35);
});

test("备注支持“驾驶员：算式”多行", () => {
  const result = evaluateRemarkExpression("张师傅：12+8\n李师傅：9");
  assert.equal(result.value, 29);
  assert.equal(result.error, "");
});

test("备注为空或非法时给出错误", () => {
  assert.ok(evaluateRemarkExpression("").error);
  assert.ok(evaluateRemarkExpression("今天休息").error);
});

test("算式() 函数读取备注列", () => {
  const result = computeAmount("算式(备注) * 单价", { ...values, 方量: 0 }, priceLookup);
  assert.equal(result.amount, 1050);
  assert.equal(result.error, "");
});

test("单价() 函数按参数取价，未命中回退默认", () => {
  assert.equal(computeAmount('方量 * 单价("朱水波")', values, priceLookup).amount, 980);
  assert.equal(computeAmount("方量 * 单价(客户名称, 车型)", values, priceLookup).amount, 1050);
});

test("单价是变量时使用行内已解析的单价", () => {
  const result = computeAmount("方量 * 单价", { ...values, 单价: 12.5 }, priceLookup);
  assert.equal(result.amount, 437.5);
});

test("round / if / max / min", () => {
  assert.equal(computeAmount("round(方量 * 单价 / 3, 1)", values, priceLookup).amount, 350);
  assert.equal(computeAmount("if(方量 > 30, 100, 50)", values, priceLookup).amount, 100);
  assert.equal(computeAmount("max(方量, 100)", values, priceLookup).amount, 100);
  assert.equal(computeAmount("min(方量, 10)", values, priceLookup).amount, 10);
});

test("字符串列可以参与拼接式公式", () => {
  const result = evaluateFormula('客户名称 + "-" + 车型', values, priceLookup);
  assert.equal(result.value, "贾建-二号");
});

test("未知列 / 未知函数会报错而不是静默为 0", () => {
  const unknown = computeAmount("不存在 * 2", values, priceLookup);
  assert.match(unknown.error, /未知的列或变量/);

  const fn = computeAmount("foo(1)", values, priceLookup);
  assert.match(fn.error, /未知函数/);
});

test("除零与语法错误", () => {
  assert.match(computeAmount("方量 / 0", values, priceLookup).error, /除数不能为 0/);
  assert.match(computeAmount("方量 *", values, priceLookup).error, /意外的/);
  assert.throws(() => parseFormula("方量 )"), /多余的内容/);
});

test("金额按小数位四舍五入", () => {
  assert.equal(computeAmount("方量 * 12.345", { ...values, 方量: 3 }, priceLookup, 2).amount, 37.04);
  assert.equal(computeAmount("方量 * 12.345", { ...values, 方量: 3 }, priceLookup, 0).amount, 37);
});

test("公式里不能执行任意代码", () => {
  assert.match(computeAmount("process.exit(1)", values, priceLookup).error, /未知的列或变量|无法识别/);
  assert.match(computeAmount("globalThis", values, priceLookup).error, /未知的列或变量/);
});

test("数字字符串参与运算", () => {
  const result = computeAmount("方量 * 2", { ...values, 方量: "21.5" }, priceLookup);
  assert.equal(result.amount, 43);
});
