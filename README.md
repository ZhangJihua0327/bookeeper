# Bookeeper

泵车 / 搅拌车 记账与看板。Node.js + MySQL，单页前端，无构建步骤，运行时只依赖 `mysql2`。

线上地址：<https://bookeeper.lollipopzzz.cn>

## 两张表

| 表 | 列 |
| --- | --- |
| 泵车表 | 日期、车型、客户名称、方量、施工地点、备注（选填） |
| 搅拌车表 | 日期、客户名称、方量、备注、车型（选填）、施工地点（选填） |

搅拌车的方量可以留空：备注里写 `12*2+11` 这类算式，服务端按“方量公式”自动算出 35。

## 功能

- **录入**：两张表分别填写，实时显示方量 / 单价 / 金额；支持编辑、删除。
- **看板**：按日期区间、表、客户、车型、施工地点、关键词筛选；总方量 / 总金额 / 记录数 / 客户数 / 平均单价；按客户、车型、地点、日期、表分组汇总；明细分页；导出 CSV（带 BOM，Excel 直接打开）。
- **配置**：
  - 客户名称、车型、施工地点三个字典都可以增删，录入时输入新值也会自动收录；
  - 单价按「客户 + 车型」配置，未命中时依次回退到客户默认、车型默认、全局默认（`*`）；
  - **公式可配置**，变量就是表里的列名：

    | 列 | 说明 |
    | --- | --- |
    | `日期` `车型` `客户名称` `方量` `施工地点` `备注` | 当前行的列值 |
    | `单价` | 按当前行客户 / 车型查出来的单价 |

    支持的函数：`单价(客户[, 车型])`、`算式(备注)`、`round(x, n)`、`if(条件, 成立, 否则)`、`max` / `min` / `abs` / `sum`。

    默认配置：

    | 表 | 方量公式 | 金额公式 |
    | --- | --- | --- |
    | 泵车 | `方量` | `方量 * 单价` |
    | 搅拌车 | `算式(备注)` | `方量 * 单价` |

    公式由自研的词法/语法分析器求值，**不使用 `eval`**，只允许算术、比较、逻辑运算和上面这些函数。

## 本地运行

```bash
cp .env.example .env
docker network create web   # 首次
docker compose up -d --build
```

打开 <http://localhost:3000>。也可以不用 Docker，改 `.env` 里的 `DB_HOST` 指向本机 MySQL 后 `npm install && npm start`。

测试：

```bash
npm test        # 公式引擎 + API 端到端（内存 store，不需要数据库）
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD` | 数据库密码（必填） |
| `MYSQL_DATABASE` / `MYSQL_USER` | 默认 `bookeeper` |
| `APP_PASSWORD` | 访问密码；留空则不做校验 |
| `SESSION_SECRET` | 会话签名密钥（必填，改掉会让已登录用户失效） |
| `TIME_ZONE` | 默认 `Asia/Shanghai` |
| `FEISHU_*` / `BITABLE_*` / `*_FIELD_*` | 仅一次性导入历史数据时需要 |

## 部署

生产部署仍由 GitHub Actions 完成（`.github/workflows/deploy.yml`）：push 到 `main` → Actions SSH 到服务器 → `git reset --hard origin/main` → 执行 `scripts/deploy.sh`。

`scripts/deploy.sh` 做的事：

1. 把服务器上的 `$HOME/.bookeeper_env` 复制成 `.env`（运行时配置不随仓库走）；
2. 检查必填变量，确保外部网络 `web` 存在；
3. `docker compose build && docker compose up -d --remove-orphans`（旧的 `bookeeper` 容器会被同名服务替换，MySQL 首次启动自动建库）；
4. 轮询 `/api/health` 直到就绪，失败则打印日志并返回非零；
5. reload 独立网关 `~/gateway` 里的 nginx（容器 IP 变了必须 reload）；
6. 输出 `docker compose ps`。

服务器上需要存在 `$HOME/.bookeeper_env`，至少包含：

```bash
MYSQL_ROOT_PASSWORD=...
MYSQL_PASSWORD=...
SESSION_SECRET=...
APP_PASSWORD=...
```

## 一次性导入飞书历史数据

```bash
docker compose exec bookeeper node scripts/import-feishu.mjs           # 演练：只统计
docker compose exec bookeeper node scripts/import-feishu.mjs --apply   # 真正写入
```

按「表 + 日期 + 客户 + 方量 + 备注」去重，重复执行不会产生重复记录。

## 目录结构

```
src/server/    HTTP 服务、公式引擎、数据访问、鉴权
src/public/    单页前端（index.html / app.js / styles.css）
db/schema.sql  建表语句（幂等，启动时自动执行）
scripts/       deploy.sh、飞书数据导入
tests/         公式与 API 测试
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活探针（含数据库连通性） |
| GET | `/api/meta` | 表结构、字典、公式、单价 |
| GET | `/api/records` | 记录列表（支持 scope/from/to/customer/model/location/q） |
| POST | `/api/records` | 新增记录 |
| PUT / DELETE | `/api/records/:id` | 修改 / 删除 |
| GET | `/api/dashboard` | 看板汇总（KPI + 分组 + 明细） |
| GET | `/api/export.csv` | 导出 CSV |
| POST | `/api/evaluate` | 公式试算（录入页实时预览、配置页测试都走这里） |
| POST / DELETE | `/api/dicts`、`/api/dicts/:id` | 字典维护 |
| POST / PUT / DELETE | `/api/prices`、`/api/prices/:id` | 单价维护 |
| PUT | `/api/formulas` | 保存公式 |
