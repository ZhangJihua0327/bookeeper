#!/bin/sh
set -eu

DOMAIN="${DOMAIN:-bookeeper.lollipopzzz.cn}"
EMAIL="${CERTBOT_EMAIL:-Zhangjihua0327@outlook.com}"

mkdir -p certbot/www certbot/conf nginx/conf.d
cp nginx/conf.d/bookeeper.http.conf nginx/conf.d/default.conf

docker compose up -d --build bookeeper nginx

docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

cp nginx/conf.d/bookeeper.https.conf nginx/conf.d/default.conf
docker compose up -d --force-recreate nginx
