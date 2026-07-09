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

if [ -f certbot/conf/live/bookeeper.lollipopzzz.cn/fullchain.pem ]; then
  cp nginx/conf.d/bookeeper.https.conf nginx/conf.d/default.conf
else
  cp nginx/conf.d/bookeeper.http.conf nginx/conf.d/default.conf
fi

docker compose build
docker compose up -d --remove-orphans
docker compose up -d --force-recreate nginx
