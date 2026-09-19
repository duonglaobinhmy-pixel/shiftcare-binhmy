#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ] || [ ! -d server/node_modules ] || [ ! -d client/node_modules ]; then
  echo "Chưa cài package. Đang chạy setup..."
  bash ./setup-demo.sh
fi
echo "Mở web tại http://localhost:5173"
npm run dev
