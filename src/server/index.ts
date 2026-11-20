import http from "node:http";

import { createApp } from "./app.js";
import { config } from "./config.js";
import { createPool, waitForDatabase } from "./db.js";
import { migrateAndSeed } from "./seed.js";
import { MysqlStore } from "./store.js";

const log = console;

async function main() {
  log.info(`[boot] 启动 Bookeeper v2（时区 ${config.timeZone}，数据库 ${config.db.host}:${config.db.port}/${config.db.database}）`);

  const pool = createPool(config.db);
  await waitForDatabase(pool, { log });

  const store = new MysqlStore(pool);
  await migrateAndSeed(store, log);

  const app = createApp({ store, config, logger: log });
  const server = http.createServer(app);

  server.listen(config.port, "0.0.0.0", () => {
    log.info(`[boot] HTTP 服务已就绪：http://0.0.0.0:${config.port}`);
    if (!config.appPassword) {
      log.warn("[boot] 未设置 APP_PASSWORD，页面与接口无访问限制");
    }
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    log.info(`[boot] 收到 ${signal}，正在关闭…`);
    server.close(() => log.info("[boot] HTTP 已关闭"));
    await pool.end().catch(() => {});
    setTimeout(() => process.exit(0), 300).unref();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  log.error("[boot] 启动失败", error);
  process.exit(1);
});
