#!/bin/sh
set -eu

docker compose run --rm certbot renew --webroot --webroot-path /var/www/certbot
cp nginx/conf.d/bookeeper.https.conf nginx/conf.d/default.conf
docker compose exec nginx nginx -s reload
