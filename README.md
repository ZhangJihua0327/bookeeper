# Bookeeper

TypeScript + Node.js 前后端一体的车辆记账应用，直接写入飞书多维表格，并生成昨日作业内容报表。

## 表结构

泵车表：

- 日期
- 车型
- 客户名称
- 方量
- 施工地点

搅拌车表：

- 日期
- 客户名称
- 方量
- 备注：记录哪个驾驶员拉了多少方
- 驾驶员：多选字段

字段名可通过 `.env` 覆盖，默认值见 `.env.example`。

## 本地运行

```bash
cp .env.example .env
npm start
```

`npm start` 会先把 `src/` 下的 TypeScript 构建到 `dist/`，再启动服务。打开 `http://localhost:3000`。

## 必填配置

```bash
FEISHU_APP_ID=
FEISHU_APP_SECRET=
BITABLE_APP_TOKEN=
PUMP_TRUCK_TABLE_ID=
MIXER_TRUCK_TABLE_ID=
```

本地真实配置写在 `.env`，该文件已加入 `.gitignore`，不要提交。飞书应用需要具备多维表格记录读取和写入权限，并能访问对应多维表格。


## Docker Compose

Compose 使用本地已有的 `node:lts-alpine` 基础镜像构建应用镜像，并把服务开放到宿主机 80 端口：

```bash
docker compose build
docker compose up -d
```

启动后访问 http://localhost/。容器内 PORT=80，宿主机端口映射为 80:80。



## HTTPS / Nginx

生产环境域名：`bookeeper.lollipopzzz.cn`。

DNS 先把 `bookeeper.lollipopzzz.cn` 的 A 记录解析到云服务器公网 IP，并确认服务器安全组开放 80 和 443。

首次签发证书并启用 HTTPS：

```bash
cd /opt/bookeeper
cp .env.example .env
# 编辑 .env，填入飞书配置
export CERTBOT_EMAIL=Zhangjihua0327@outlook.com
sh scripts/init-https.sh
```

脚本流程：

1. nginx 先用 HTTP 配置启动，代理应用并暴露 `/.well-known/acme-challenge/`。
2. `certbot/certbot:latest` 使用 webroot 方式签发 `bookeeper.lollipopzzz.cn` 证书。
3. 签发成功后切换到 HTTPS nginx 配置，并把 80 重定向到 443。

续期证书：

```bash
cd /opt/bookeeper
sh scripts/renew-https.sh
```

建议添加服务器 crontab：

```cron
0 3 * * 1 cd /opt/bookeeper && sh scripts/renew-https.sh >> certbot-renew.log 2>&1
```

当前 `docker-compose.yml` 使用：

- `bookeeper`：内部监听 3000
- `nginx:stable-alpine3.23-perl`：公网 80/443
- `certbot/certbot:latest`：签发和续期证书
## GitHub 自动部署

服务器准备：

```bash
git clone <你的仓库地址> /opt/bookeeper
cd /opt/bookeeper
cp .env.example .env
# 编辑 .env，填入飞书配置
docker compose up -d --build
```

GitHub 仓库添加 Actions Secrets：

- `DEPLOY_HOST`：服务器 IP 或域名
- `DEPLOY_USER`：SSH 用户
- `DEPLOY_SSH_KEY`：该用户的私钥内容
- `DEPLOY_PORT`：SSH 端口，默认 22
- `DEPLOY_PATH`：服务器上的项目目录，例如 `/opt/bookeeper`

之后每次 push 到 `main` 或 `master`，`.github/workflows/deploy.yml` 会自动 SSH 到服务器并执行 `scripts/deploy.sh`，完成 `docker compose build` 和 `docker compose up -d --remove-orphans`。
## API

- `POST /api/records/pump-truck`：提交泵车记录
- `POST /api/records/mixer-truck`：提交搅拌车记录
- `GET /api/report/yesterday`：按昨日生成作业报表
- `GET /api/report/yesterday?date=YYYY-MM-DD`：按指定日期生成作业报表
- GET /api/health：检查配置和字段映射
- GET /api/options：读取飞书字段下拉选项
- POST /api/options：新增字段下拉选项





