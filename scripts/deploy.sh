#!/bin/sh
set -eu

if [ ! -f .env ]; then
  echo "Missing .env in $(pwd). Create it from .env.example before deploy." >&2
  exit 1
fi

if [ -f certbot/conf/live/bookeeper.lollipopzzz.cn/fullchain.pem ]; then
  cp nginx/conf.d/bookeeper.https.conf nginx/conf.d/default.conf
else
  cp nginx/conf.d/bookeeper.http.conf nginx/conf.d/default.conf
fi

docker compose build
docker compose up -d --remove-orphans
