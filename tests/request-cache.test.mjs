import assert from "node:assert/strict";
import test from "node:test";
import { ExpiringRequestCache, IdempotencyConflictError } from "../dist/server/request-cache.js";

test("相同提交 ID 的并发和后续请求只执行一次", async () => {
  const cache = new ExpiringRequestCache(60_000);
  let executions = 0;
  const operation = async () => {
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { recordId: "record-1" };
  };

  const [first, concurrent] = await Promise.all([
    cache.execute("pump:id-1", "payload-a", operation),
    cache.execute("pump:id-1", "payload-a", operation),
  ]);
  const replay = await cache.execute("pump:id-1", "payload-a", operation);

  assert.equal(executions, 1);
  assert.deepEqual(first.value, { recordId: "record-1" });
  assert.deepEqual(concurrent.value, first.value);
  assert.deepEqual(replay.value, first.value);
  assert.equal([first.replayed, concurrent.replayed].filter(Boolean).length, 1);
  assert.equal(replay.replayed, true);
});

test("相同提交 ID 不能对应不同内容", async () => {
  const cache = new ExpiringRequestCache(60_000);
  await cache.execute("pump:id-1", "payload-a", async () => "ok");

  await assert.rejects(
    cache.execute("pump:id-1", "payload-b", async () => "other"),
    IdempotencyConflictError,
  );
});

test("执行失败后允许使用相同提交 ID 重试", async () => {
  const cache = new ExpiringRequestCache(60_000);
  await assert.rejects(cache.execute("pump:id-1", "payload-a", async () => {
    throw new Error("temporary failure");
  }));

  const retried = await cache.execute("pump:id-1", "payload-a", async () => "ok");
  assert.deepEqual(retried, { value: "ok", replayed: false });
});
