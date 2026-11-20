import assert from "node:assert/strict";
import test from "node:test";

import { buildOcrPrompt, extractJson, normalizeOcrResult, recognizeLedger } from "../src/server/ocr.js";

test("提示词带上客户与车型名单", () => {
  const prompt = buildOcrPrompt({ customers: ["朱水波", "贾建"], truckModels: ["一号", "二号"] });
  assert.match(prompt, /客户：朱水波、贾建/);
  assert.match(prompt, /车型：一号、二号/);
  assert.match(prompt, /只输出严格 JSON/);
  assert.match(prompt, /8\+3/);
});

test("提示词在没有名单时也能用", () => {
  const prompt = buildOcrPrompt({});
  assert.match(prompt, /暂无名单/);
});

test("extractJson 容忍代码块与前后废话", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('好的，结果如下：{"a":2} 希望有帮助'), { a: 2 });
  assert.throws(() => extractJson("没有 JSON"), /不是合法|合法的 JSON/);
});

test("normalizeOcrResult 归一化字段并过滤脏数据", () => {
  const result = normalizeOcrResult(
    {
      date: "2026-11-18",
      entries: [
        { table: "pump", customer: " 贾建 ", volume: "35", note: "垫层", confidence: 0.9 },
        { table: "mixer", customer: "朱水波", volume: 52, note: "12×3 姜" },
        { table: "unknown", customer: "x", volume: 1 },
        { table: "pump", customer: "", volume: 0 },
        { table: "pump", customer: "亿德鑫", volume: 8, confidence: 1.7 },
      ],
    },
    { today: "2026-11-20" },
  );

  assert.equal(result.date, "2026-11-18");
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0].customer, "贾建");
  assert.equal(result.entries[0].volume, 35);
  assert.equal(result.entries[0].confidence, 0.9);
  assert.equal(result.entries[1].confidence, null);
  assert.equal(result.entries[2].confidence, 1);
});

test("normalizeOcrResult 日期非法时回退到今天", () => {
  const result = normalizeOcrResult({ date: "11月18日", entries: [] }, { today: "2026-11-20" });
  assert.equal(result.date, "2026-11-20");
});

test("recognizeLedger 解析模型返回内容", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [
          {
            message: {
              content: '```json\n{"date":"2026-11-18","entries":[{"table":"pump","customer":"贾建","volume":35,"note":"垫层"}]}\n```',
            },
          },
        ],
      }),
  });

  const result = await recognizeLedger({
    apiKey: "test-key",
    imageDataUrl: "data:image/jpeg;base64,AAAA",
    dicts: { customers: ["贾建"] },
    today: "2026-11-20",
    fetchImpl: fakeFetch,
  });

  assert.equal(result.date, "2026-11-18");
  assert.equal(result.entries[0].customer, "贾建");
  assert.equal(result.entries[0].volume, 35);
});

test("recognizeLedger 在接口报错时抛出可读信息", async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => '{"message":"Invalid API-key"}' });
  await assert.rejects(
    () => recognizeLedger({ apiKey: "bad", imageDataUrl: "data:image/jpeg;base64,AAAA", fetchImpl: fakeFetch }),
    /401.*Invalid API-key/,
  );
});

test("recognizeLedger 没有 key 时直接报错", async () => {
  await assert.rejects(() => recognizeLedger({ apiKey: "", imageDataUrl: "data:image/jpeg;base64,AAAA" }), /DASHSCOPE_API_KEY/);
});
