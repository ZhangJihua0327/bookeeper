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
