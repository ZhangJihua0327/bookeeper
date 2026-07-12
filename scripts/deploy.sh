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
gateway_available=false
if [ -f "$gateway_dir/docker-compose.yml" ] || [ -f "$gateway_dir/compose.yml" ]; then
  gateway_available=true
  (
    cd "$gateway_dir"
    docker compose exec -T nginx nginx -t
    docker compose exec -T nginx nginx -s reload
  )
else
  echo "Warning: standalone gateway not found at $gateway_dir; Nginx was not reloaded." >&2
fi

diagnostics_failed=false
echo "Running post-deploy read-only diagnostics..."
docker inspect --format 'bookeeper restart_count={{.RestartCount}} status={{.State.Status}}' bookeeper

backend_ready=false
attempt=1
while [ "$attempt" -le 15 ]; do
  if docker exec bookeeper node -e 'fetch("http://127.0.0.1:3000/api/health").then((response) => { if (!response.ok) process.exit(1); })' >/dev/null 2>&1; then
    backend_ready=true
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done

if [ "$backend_ready" = false ]; then
  echo "bookeeper did not become ready within 15 seconds." >&2
  diagnostics_failed=true
fi

if [ "$backend_ready" = true ]; then
  docker exec bookeeper node -e '
    fetch("http://127.0.0.1:3000/api/options")
    .then((response) => {
      console.log(`backend-local /api/options status=${response.status}`);
      if (!response.ok) process.exitCode = 1;
    })
    .catch((error) => { console.error(error); process.exitCode = 1; });
  ' || diagnostics_failed=true
fi

if [ "$gateway_available" = true ]; then
  (
    cd "$gateway_dir"
    docker compose exec -T nginx wget -q -O /dev/null http://bookeeper:3000/api/options
  ) || diagnostics_failed=true
fi

if [ "$diagnostics_failed" = true ]; then
  echo "Post-deploy diagnostics failed. Recent logs follow." >&2
  docker logs --tail 100 bookeeper >&2 || true
  if [ "$gateway_available" = true ]; then
    (
      cd "$gateway_dir"
      docker compose logs --tail 100 nginx
    ) >&2 || true
  fi
  exit 1
fi
