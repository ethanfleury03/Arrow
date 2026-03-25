#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
[ -d "$DIST" ] || { echo "dist folder not found: $DIST" >&2; exit 1; }
EXE="$(find "$DIST" -type f -name '*.exe' | head -n 1 || true)"
[ -n "$EXE" ] || { echo "No .exe artifact found in dist." >&2; exit 1; }
SIZE="$(wc -c < "$EXE" | tr -d ' ')"
cat > "$DIST/BUILD_REPORT.txt" <<REPORT
Build verification timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Verified artifact: $EXE
Artifact size (bytes): $SIZE
Verification status: PASS
REPORT
echo "Verified EXE artifact: $EXE"
echo "Wrote report: $DIST/BUILD_REPORT.txt"
