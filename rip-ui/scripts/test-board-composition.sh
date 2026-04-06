#!/bin/bash
# Test script for board composition job flow
# Usage: ./test-board-composition.sh [adapter_url]
# Default adapter_url: http://localhost:8080

ADAPTER_URL="${1:-http://localhost:8080}"
BRIDGE_URL="${2:-http://localhost:8787}"

echo "=== Board Composition Test ==="
echo "Adapter URL: $ADAPTER_URL"
echo "Bridge URL: $BRIDGE_URL"
echo ""

# Check adapter health
echo "1. Checking adapter health..."
HEALTH=$(curl -s "$ADAPTER_URL/health")
echo "   Health: $HEALTH"
echo ""

# Check bridge health
echo "2. Checking bridge health..."
curl -s "$BRIDGE_URL/api/health" 2>/dev/null || echo "   (No health endpoint, continuing...)"
echo ""

# Test board composition via bridge proxy
echo "3. Submitting board job via bridge proxy..."
echo "   This creates a board with 2 PDFs placed side-by-side"

# Create a test payload (adjust paths to actual PDF files on your system)
BOARD_JSON='{
  "board_width_inches": 8.5,
  "board_height_inches": 11.0,
  "placements": [
    {
      "pdf_path": "/tmp/test_label.pdf",
      "x_inches": 0.5,
      "y_inches": 0.5,
      "scale": 1.0,
      "rotation_degrees": 0,
      "page_number": 0
    },
    {
      "pdf_path": "/tmp/test_label.pdf",
      "x_inches": 4.5,
      "y_inches": 0.5,
      "scale": 1.0,
      "rotation_degrees": 0,
      "page_number": 0
    }
  ],
  "args": ["--dry-run"],
  "env": {}
}'

echo "$BOARD_JSON" | curl -s -X POST "$BRIDGE_URL/api/jobs/board" \
  -H "Content-Type: application/json" \
  -d @- | jq '.' || echo "   (jq not available, raw output above)"

echo ""
echo "=== Test Complete ==="
