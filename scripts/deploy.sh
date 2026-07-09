#!/bin/sh
set -eu

docker compose build
docker compose up -d --remove-orphans
