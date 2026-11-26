#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f server/.env ] || { echo 'Configure server/.env first'; exit 1; }
npm --prefix server ci --no-audit --no-fund
npm --prefix client ci --no-audit --no-fund
npm --prefix client run build
npm --prefix server run db:migrate:middleware
