#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "山河入谱 · http://localhost:8000"
python3 -m http.server 8000
