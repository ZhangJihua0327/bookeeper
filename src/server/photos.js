/**
 * 台账照片归档：本地磁盘按日期分目录存放，
 *   <root>/2026-11-18/1734567890-ab12cd.jpg
 * 路径全部经过白名单校验，避免目录穿越。
 */

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_RE = /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/;

export const ALLOWED_EXT = new Set(["jpg", "png", "webp"]);

export function isValidDate(value) {
  return DATE_RE.test(String(value || ""));
}

export async function savePhoto({ root, date, bytes, ext }) {
  if (!isValidDate(date)) throw new Error("照片日期格式不正确");
  if (!ALLOWED_EXT.has(ext)) throw new Error("不支持的图片格式");

  const dir = join(root, date);
  await mkdir(dir, { recursive: true });

  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await writeFile(join(dir, name), bytes);
  return { date, name, bytes: bytes.length };
}

/** 列出有照片的日期（新→旧），带张数与总大小。 */
export async function listPhotoDates(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const dates = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !DATE_RE.test(entry.name)) continue;
    const files = (await readdir(join(root, entry.name)).catch(() => [])).filter((name) => NAME_RE.test(name));
    if (!files.length) continue;

    let bytes = 0;
    for (const name of files) {
      const info = await stat(join(root, entry.name, name)).catch(() => null);
      if (info?.isFile()) bytes += info.size;
    }
    dates.push({ date: entry.name, count: files.length, bytes });
  }

  return dates.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** 列出某天的照片（新→旧）。 */
export async function listPhotos(root, date) {
  if (!isValidDate(date)) throw new Error("照片日期格式不正确");

  const dir = join(root, date);
  const files = await readdir(dir).catch(() => []);
  const photos = [];

  for (const name of files) {
    if (!NAME_RE.test(name)) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info?.isFile()) continue;
    photos.push({ date, name, bytes: info.size, mtime: info.mtime.toISOString() });
  }

  return photos.sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** 校验并返回单张照片的绝对路径；非法返回 null。 */
export function resolvePhotoPath(root, date, name) {
  if (!isValidDate(date) || !NAME_RE.test(String(name || ""))) return null;

  const base = resolve(root);
  const target = resolve(base, date, String(name));
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

export function mimeFor(name) {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
