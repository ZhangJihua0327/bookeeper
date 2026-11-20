import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_OCR_MODEL } from "./ocr.js";

loadDotEnv();

const env = process.env;

function int(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: int(env.PORT, 3000),
  timeZone: env.TIME_ZONE || "Asia/Shanghai",
  appPassword: env.APP_PASSWORD || "",
  sessionSecret: env.SESSION_SECRET || "",
  sessionTtlMs: int(env.SESSION_TTL_HOURS, 24 * 7) * 60 * 60 * 1000,
  db: {
    host: env.DB_HOST || "127.0.0.1",
    port: int(env.DB_PORT, 3306),
    database: env.DB_NAME || "bookeeper",
    user: env.DB_USER || "bookeeper",
    password: env.DB_PASSWORD || "",
    connectionLimit: int(env.DB_POOL_SIZE, 8),
  },
  // 拍照识别（阿里云百炼 DashScope 视觉模型）
  dashscope: {
    apiKey: env.DASHSCOPE_API_KEY || "",
    model: env.DASHSCOPE_VL_MODEL || DEFAULT_OCR_MODEL,
    timeoutMs: int(env.DASHSCOPE_TIMEOUT_MS, 120000),
  },
};

if (!config.sessionSecret) {
  config.sessionSecret = "bookeeper-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  console.warn("[config] SESSION_SECRET 未设置，已生成临时密钥（重启后会话失效）");
}

if (!config.appPassword) {
  console.warn("[config] APP_PASSWORD 未设置：任何人都可以打开页面并写入数据");
}

function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
