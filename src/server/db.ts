import type { Pool } from "mysql2/promise";
import mysql from "mysql2/promise";

type DatabaseConfig = (typeof import("./config.js").config)["db"];

export function createPool(dbConfig: DatabaseConfig) {
  return mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    waitForConnections: true,
    connectionLimit: dbConfig.connectionLimit ?? 8,
    queueLimit: 0,
    charset: "utf8mb4",
    dateStrings: ["DATE", "DATETIME"],
    decimalNumbers: true,
    multipleStatements: true,
    timezone: "local",
  });
}

/** 启动时等 MySQL 就绪（容器编排里 depends_on 已保证，这里再加一层兜底）。 */
export async function waitForDatabase(pool: Pool, { attempts = 30, delayMs = 1000, log = console } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const connection = await pool.getConnection();
      try {
        await connection.query("SELECT 1");
      } finally {
        connection.release();
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 1 || attempt % 5 === 0) {
        const detail = error as NodeJS.ErrnoException;
        log.warn(`[db] 等待数据库就绪（第 ${attempt}/${attempts} 次）：${detail.code || detail.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
