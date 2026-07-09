#!/bin/sh
set -eu

if [ -f certbot/conf/live/bookeeper.lollipopzzz.cn/fullchain.pem ]; then
  cp nginx/conf.d/bookeeper.https.conf nginx/conf.d/default.conf
else
  cp nginx/conf.d/bookeeper.http.conf nginx/conf.d/default.conf
fi

docker compose build
docker compose up -d --remove-orphans
