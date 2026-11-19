#!/bin/sh
# 生产部署脚本：由 GitHub Actions 在服务器上执行（见 .github/workflows/deploy.yml）
set -eu

# 1) 运行时配置放在服务器本地（$HOME/.bookeeper_env），不随仓库分发
if [ -f "$HOME/.bookeeper_env" ]; then
  cp "$HOME/.bookeeper_env" .env
  chmod 600 .env
fi

if [ ! -f .env ]; then
  echo "Missing .env in $(pwd). 请在服务器创建 $HOME/.bookeeper_env 或本地 .env 后再部署。" >&2
  exit 1
fi

# 2) 关键变量缺失时提前失败，避免容器起一半
missing=""
for key in MYSQL_ROOT_PASSWORD MYSQL_PASSWORD SESSION_SECRET; do
  value=$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)
  [ -n "${value}" ] || missing="$missing $key"
done
if [ -n "$missing" ]; then
  echo "缺少环境变量：$missing（请在服务器 $HOME/.bookeeper_env 中补全）" >&2
  exit 1
fi

# 3) 共享外部网络：网关 nginx 通过它访问 bookeeper 容器
docker network inspect web >/dev/null 2>&1 || docker network create web

# 4) 构建并滚动替换容器（旧版的 bookeeper 容器会被同项目同名服务替换）
docker compose build
docker compose up -d --remove-orphans

# 5) 等待应用就绪（首次启动要等 MySQL 初始化 + 建表）
echo "Waiting for bookeeper to become healthy..."
ready=false
attempt=1
while [ "$attempt" -le 45 ]; do
  if docker exec bookeeper node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
  attempt=$((attempt + 1))
done

if [ "$ready" != true ]; then
  echo "bookeeper 在 90 秒内没有就绪，最近日志：" >&2
  docker compose logs --tail 80 bookeeper >&2 || true
  docker compose logs --tail 40 mysql >&2 || true
  exit 1
fi
echo "bookeeper is healthy."

# 6) 网关在加载配置时解析 bookeeper 主机名，容器 IP 变了必须 reload
gateway_dir="${GATEWAY_PATH:-$HOME/gateway}"
if [ -f "$gateway_dir/docker-compose.yml" ] || [ -f "$gateway_dir/compose.yml" ]; then
  (
    cd "$gateway_dir"
    docker compose exec -T nginx nginx -t
    docker compose exec -T nginx nginx -s reload
    docker compose exec -T nginx wget -q -O /dev/null http://bookeeper:3000/api/health
  ) || {
    echo "网关 reload 或内网健康检查失败，最近日志：" >&2
    ( cd "$gateway_dir" && docker compose logs --tail 60 nginx ) >&2 || true
    exit 1
  }
  echo "gateway reloaded."
else
  echo "Warning: 未找到网关目录 $gateway_dir，跳过 nginx reload。" >&2
fi

docker compose ps
echo "Deploy finished."
