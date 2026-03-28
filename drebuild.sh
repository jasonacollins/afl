#!/bin/bash

# Rebuild and restart the local Docker containers
# Usage: ./drebuild.sh (run from the afl project root)

[[ "$(basename "$PWD")" != "afl" ]] && { echo "Run this from the afl directory"; exit 1; }

docker compose down && docker compose build && docker compose up -d
