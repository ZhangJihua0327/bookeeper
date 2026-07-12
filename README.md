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
- 备注：每行按“驾驶员：每车方量算式”记录运输明细
- 驾驶员：多选字段，由备注明细自动生成

搅拌车记账页按驾驶员展开运输明细，每车方量仅支持数字、加号和乘号（如 `12+8×2`）。页面会自动计算总方量并汇总驾驶员，提交到飞书时仍使用上述原有字段，不改变多维表结构。

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

Compose 构建应用镜像，应用仅在 Docker 外部网络 `web` 中暴露 3000 端口。首次启动前创建网络：

```bash
docker network create web
docker compose up -d --build
```

生产流量由独立网关转发到 `bookeeper:3000`，应用本身不绑定宿主机端口。



## 独立 HTTPS 网关

Nginx 和 Certbot 在服务器上的独立 Compose 项目 `~/gateway` 中运行，不属于本应用，也不随本应用部署。生产域名 `bookeeper.lollipopzzz.cn` 的站点配置通过共享 Docker 网络 `web` 访问 `bookeeper:3000`。

DNS 先把 `bookeeper.lollipopzzz.cn` 的 A 记录解析到云服务器公网 IP，并确认服务器安全组开放 80 和 443。

接入其他应用时，让应用加入外部网络 `web`，然后在网关中增加一个站点配置，例如：

```nginx
server {
    listen 443 ssl;
    server_name service.lollipopzzz.cn;

    ssl_certificate /etc/letsencrypt/live/service.lollipopzzz.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/service.lollipopzzz.cn/privkey.pem;

    location / {
        proxy_pass http://service:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

新域名需先添加指向服务器的 DNS 记录，再由网关签发证书：

```bash
cd ~/gateway
docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
  -d service.lollipopzzz.cn --email YOUR_EMAIL --agree-tos --no-eff-email
docker compose exec nginx nginx -s reload
```

证书续期由独立网关的 Certbot 容器负责。应用部署完成后，`scripts/deploy.sh` 会执行
`nginx -t` 并 reload 独立网关，让 Nginx 重新解析可能已变更的 `bookeeper` 容器地址。
网关目录默认是 `~/gateway`，也可以通过服务器环境变量 `GATEWAY_PATH` 覆盖。
部署脚本随后会从后端容器本机和 Nginx 容器读取 `/api/options`，GitHub Runner 再从公网域名
进行最多 5 次探测。任一只读探测失败时，Actions 会输出 bookeeper 与 Nginx 的最近日志并
标记部署检查失败。
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

下拉选项在服务端缓存 5 分钟；实际新增字段选项后缓存会立即失效。记录提交支持前端生成的
`submissionId`，同一实例在 10 分钟内收到相同 ID 和内容时会复用首次执行结果，降低连接中断后
重复提交造成重复记录的风险。

