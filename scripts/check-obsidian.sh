#!/usr/bin/env bash
# Obsidian Community Plugin compliance checker.
# Catches issues that the ObsidianReviewBot flags during plugin submission.
# Run: npm run check:obsidian

set -euo pipefail

SRC_DIR="src"
ERRORS=0

check() {
  local label="$1"
  local pattern="$2"
  local matches

  matches=$(grep -rn --include="*.ts" -E "$pattern" "$SRC_DIR" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "FAIL: $label"
    echo "$matches" | sed 's/^/  /'
    echo
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $label"
  fi
}

echo "=== Obsidian Community Plugin Compliance Check ==="
echo

# 1. No innerHTML / outerHTML (XSS risk)
check "No innerHTML/outerHTML" '\.(innerHTML|outerHTML)\s*='

# 2. No fetch() — must use requestUrl() from obsidian
check "No fetch() calls" '\bfetch\s*\('

# 3. No Node.js imports (breaks mobile)
check "No Node.js fs import" "(import.*from ['\"]fs['\"]|require\(['\"]fs['\"])"
check "No Node.js path import" "(import.*from ['\"]path['\"]|require\(['\"]path['\"])"
check "No Node.js child_process import" "(import.*from ['\"]child_process['\"]|require\(['\"]child_process['\"])"

# 4. No regex lookbehind (breaks iOS WebKit)
check "No regex lookbehind" '\(\?<[!=]'

# 5. Plugin ID must not contain "obsidian"
PLUGIN_ID=$(grep -o '"id":\s*"[^"]*"' manifest.json | sed 's/.*"\([^"]*\)".*/\1/' || echo "")
if echo "$PLUGIN_ID" | grep -qi "obsidian"; then
  echo "FAIL: Plugin ID must not contain 'obsidian' (found: $PLUGIN_ID)"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: Plugin ID clean ($PLUGIN_ID)"
fi

# 6. Description must not contain "Obsidian" (Obsidian review bot flags this)
PLUGIN_DESC=$(grep -o '"description":\s*"[^"]*"' manifest.json | sed 's/"description":\s*"\(.*\)"/\1/' || echo "")
if echo "$PLUGIN_DESC" | grep -q "Obsidian"; then
  echo "FAIL: manifest.json description should not contain 'Obsidian' (review bot flags this)"
  echo "  Current: $PLUGIN_DESC"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: Description clean"
fi

echo
if [ "$ERRORS" -gt 0 ]; then
  echo "=== $ERRORS issue(s) found ==="
  exit 1
else
  echo "=== All checks passed ==="
  exit 0
fi
