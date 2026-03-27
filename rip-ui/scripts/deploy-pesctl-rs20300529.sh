#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_SCRIPT="$ROOT_DIR/docs/pesctl"
REMOTE_HOST="root@192.168.100.200"
REMOTE_PATH="/usr/local/bin/pesctl"

if [[ ! -f "$LOCAL_SCRIPT" ]]; then
  echo "Local script not found: $LOCAL_SCRIPT" >&2
  exit 1
fi

LOCAL_SHA="$(tr -d '\r' < "$LOCAL_SCRIPT" | shasum -a 256 | awk '{print $1}')"

echo "Deploying $LOCAL_SCRIPT -> ${REMOTE_HOST}:${REMOTE_PATH}"
tr -d '\r' < "$LOCAL_SCRIPT" | ssh "$REMOTE_HOST" "cat > '$REMOTE_PATH' && chmod +x '$REMOTE_PATH'"

REMOTE_SHA="$(ssh "$REMOTE_HOST" "if command -v sha256sum >/dev/null 2>&1; then sha256sum '$REMOTE_PATH' | awk '{print \$1}'; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 '$REMOTE_PATH' | awk '{print \$1}'; else echo NO_HASH_TOOL; fi")"

echo "local_sha256=$LOCAL_SHA"
echo "remote_sha256=$REMOTE_SHA"

if [[ "$REMOTE_SHA" == "$LOCAL_SHA" ]]; then
  echo "OK: hashes match"
else
  echo "WARNING: hash mismatch" >&2
  exit 2
fi
