#!/bin/sh
set -eu

if [ -f "$HOME/.bookeeper_env" ]; then
  cp "$HOME/.bookeeper_env" .env
  chmod 600 .env
fi

if [ ! -f .env ]; then
  echo "Missing .env in $(pwd). Create $HOME/.bookeeper_env or .env before deploy." >&2
  exit 1
fi

docker network inspect web >/dev/null 2>&1 || docker network create web
docker compose build
docker compose up -d --remove-orphans

# The standalone gateway resolves the bookeeper container name when Nginx loads
# its configuration. Reload it after recreating bookeeper so a changed container
# IP does not leave Nginx proxying to a stale upstream address.
gateway_dir="${GATEWAY_PATH:-$HOME/gateway}"
if [ -f "$gateway_dir/docker-compose.yml" ] || [ -f "$gateway_dir/compose.yml" ]; then
  (
    cd "$gateway_dir"
    docker compose exec -T nginx nginx -t
    docker compose exec -T nginx nginx -s reload
  )
else
  echo "Warning: standalone gateway not found at $gateway_dir; Nginx was not reloaded." >&2
fi
