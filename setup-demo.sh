#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "== ShiftCare BCARE Full Demo v7 =="
echo "[1/3] Cài package root..."
npm install
echo "[2/3] Cài backend..."
npm --prefix server install
echo "[3/3] Cài frontend..."
npm --prefix client install
echo "Hoàn tất. Chạy: npm run dev"
