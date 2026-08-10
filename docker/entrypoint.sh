#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R bun:bun /data
  exec su-exec bun "$@"
fi

exec "$@"
