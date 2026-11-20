import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listPhotoDates, listPhotos, mimeFor, resolvePhotoPath, savePhoto } from "../src/server/photos.js";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "bookeeper-photos-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("savePhoto 按日期目录归档", async () => {
  await withTempDir(async (root) => {
    const saved = await savePhoto({ root, date: "2026-11-18", bytes: Buffer.from("hello"), ext: "jpg" });
    assert.equal(saved.date, "2026-11-18");
    assert.match(saved.name, /^\d+-[a-z0-9]+\.jpg$/);
    assert.equal(saved.bytes, 5);

    const photos = await listPhotos(root, "2026-11-18");
    assert.equal(photos.length, 1);
    assert.equal(photos[0].name, saved.name);
    assert.equal(photos[0].bytes, 5);
  });
});

test("listPhotoDates 汇总每天的张数并按日期倒序", async () => {
  await withTempDir(async (root) => {
    await savePhoto({ root, date: "2026-11-17", bytes: Buffer.from("a"), ext: "jpg" });
    await savePhoto({ root, date: "2026-11-18", bytes: Buffer.from("bb"), ext: "png" });
    await savePhoto({ root, date: "2026-11-18", bytes: Buffer.from("ccc"), ext: "jpg" });

    const dates = await listPhotoDates(root);
    assert.deepEqual(
      dates.map((item) => [item.date, item.count]),
      [
        ["2026-11-18", 2],
        ["2026-11-17", 1],
      ],
    );
    assert.equal(dates[0].bytes, 5);
  });
});

test("目录不存在时返回空数组", async () => {
  await withTempDir(async (root) => {
    assert.deepEqual(await listPhotoDates(join(root, "missing")), []);
    assert.deepEqual(await listPhotos(join(root, "missing"), "2026-11-18"), []);
  });
});

test("非法日期与非法扩展名被拒绝", async () => {
  await withTempDir(async (root) => {
    await assert.rejects(() => savePhoto({ root, date: "../../etc", bytes: Buffer.from("x"), ext: "jpg" }), /日期格式/);
    await assert.rejects(() => savePhoto({ root, date: "2026-11-18", bytes: Buffer.from("x"), ext: "sh" }), /格式/);
    await assert.rejects(() => listPhotos(root, "2026-11-18/../../x"), /日期格式/);
  });
});

test("resolvePhotoPath 阻断目录穿越", async () => {
  await withTempDir(async (root) => {
    assert.equal(resolvePhotoPath(root, "2026-11-18", "../../secret.jpg"), null);
    assert.equal(resolvePhotoPath(root, "..", "a.jpg"), null);
    assert.equal(resolvePhotoPath(root, "2026-11-18", "a.sh"), null);
    assert.match(resolvePhotoPath(root, "2026-11-18", "1730000000-abc.jpg"), /2026-11-18/);
  });
});

test("忽略非图片文件", async () => {
  await withTempDir(async (root) => {
    const dir = join(root, "2026-11-18");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "note.txt"), "x");
    await writeFile(join(dir, "1730000000-abc.jpg"), "img");

    const photos = await listPhotos(root, "2026-11-18");
    assert.equal(photos.length, 1);
    assert.equal(photos[0].name, "1730000000-abc.jpg");
  });
});

test("mimeFor 按扩展名返回类型", () => {
  assert.equal(mimeFor("a.jpg"), "image/jpeg");
  assert.equal(mimeFor("a.png"), "image/png");
  assert.equal(mimeFor("a.webp"), "image/webp");
});
