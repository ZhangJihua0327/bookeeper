import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateVolumeExpression,
  makeMixerTruckFields,
  parseMixerTruckRemark,
  validateMixerTruck,
} from "../dist/server/report.js";

test("方量算式仅支持加法和乘法，并按乘法优先计算", () => {
  assert.deepEqual(evaluateVolumeExpression(" 12 + 8x2 "), {
    value: 28,
    normalized: "12+8×2",
    error: "",
  });

  for (const expression of ["12-2", "12/2", "(12+2)×3"]) {
    assert.match(evaluateVolumeExpression(expression).error, /只能使用数字、加号和乘号/);
  }
});

test("多行备注自动生成总方量和去重后的驾驶员", () => {
  const parsed = parseMixerTruckRemark("张三：12+8×2\n李四: 6*3\n张三：2");

  assert.equal(parsed.totalVolume, 48);
  assert.deepEqual(parsed.drivers, ["张三", "李四"]);
  assert.equal(parsed.remark, "张三：12+8×2\n李四：6×3\n张三：2");
  assert.deepEqual(parsed.errors, []);
});

test("飞书字段始终从备注重新生成，不信任请求中的汇总值", () => {
  const fields = makeMixerTruckFields({
    date: "2026-07-10",
    customerName: "测试客户",
    remark: "张三：10×2\n李四：5+5",
    volume: 999,
    drivers: ["错误驾驶员"],
  }, {
    date: "日期",
    customerName: "客户名称",
    volume: "方量",
    remark: "备注",
    drivers: "驾驶员",
  });

  assert.equal(fields["方量"], 30);
  assert.deepEqual(fields["驾驶员"], ["张三", "李四"]);
  assert.equal(fields["备注"], "张三：10×2\n李四：5+5");
});

test("搅拌车校验能指出具体错误行", () => {
  const errors = validateMixerTruck({
    date: "2026-07-10",
    customerName: "测试客户",
    remark: "张三 12\n李四：8/2",
  });

  assert.deepEqual(errors, [
    "第 1 条应为“驾驶员：每车方量算式”",
    "第 2 条方量只能使用数字、加号和乘号",
  ]);
});
