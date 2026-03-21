#!/usr/bin/env bash
# Obsidian Community Plugin compliance checker.
# Catches issues that the ObsidianReviewBot flags during plugin submission.
# Based on:
#   https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins
#   https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
#
# Run: npm run check:obsidian

set -euo pipefail

SRC_DIR="src"
ERRORS=0
WARNINGS=0

check() {
  local label="$1"
  local pattern="$2"
  local matches

  # Exclude test files and benchmarks
  matches=$(grep -rn --include="*.ts" --exclude="*.test.ts" --exclude="*.bench.ts" -E "$pattern" "$SRC_DIR" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "FAIL: $label"
    echo "$matches" | sed 's/^/  /'
    echo
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $label"
  fi
}

warn() {
  local label="$1"
  local detail="$2"
  echo "WARN: $label"
  echo "  $detail"
  echo
  WARNINGS=$((WARNINGS + 1))
}

echo "=== Obsidian Community Plugin Compliance Check ==="
echo
echo "--- Code Checks ---"

# 1. No innerHTML / outerHTML / insertAdjacentHTML (XSS risk)
check "No innerHTML/outerHTML" '\.(innerHTML|outerHTML)\s*='
check "No insertAdjacentHTML" '\.insertAdjacentHTML\s*\('

# 2. No fetch() — must use requestUrl() from obsidian
check "No fetch() calls" '\bfetch\s*\('

# 3. No Node.js imports (breaks mobile)
check "No Node.js fs import" "(import.*from ['\"]fs['\"]|require\(['\"]fs['\"])"
check "No Node.js path import" "(import.*from ['\"]path['\"]|require\(['\"]path['\"])"
check "No Node.js child_process import" "(import.*from ['\"]child_process['\"]|require\(['\"]child_process['\"])"

# 4. No regex lookbehind (breaks iOS WebKit)
check "No regex lookbehind" '\(\?<[!=]'

# 5. No console.log in production code (debug noise)
# Exclude logger.ts — it uses console.warn as last-resort fallback when log file fails
check "No console.log" '\bconsole\.(log|debug|info)\s*\('
CONSOLE_WARN=$(grep -rn --include="*.ts" --exclude="*.test.ts" --exclude="*.bench.ts" -E '\bconsole\.warn\s*\(' "$SRC_DIR" 2>/dev/null | grep -v "logger.ts" || true)
if [ -n "$CONSOLE_WARN" ]; then
  echo "FAIL: No console.warn (outside logger.ts)"
  echo "$CONSOLE_WARN" | sed 's/^/  /'
  echo
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: No console.warn (logger.ts exempted)"
fi

# 6. No global app — use this.app
check "No global app reference" '\bwindow\.app\b'

# 7. No workspace.activeLeaf (deprecated)
check "No workspace.activeLeaf" '\.activeLeaf\b'

# 8. No sample code placeholders
check "No sample code placeholders" '\b(MyPlugin|SampleSettingTab|SamplePlugin)\b'

echo
echo "--- manifest.json Checks ---"

# 9. Plugin ID must not contain "obsidian"
PLUGIN_ID=$(grep -o '"id":\s*"[^"]*"' manifest.json | sed 's/.*"\([^"]*\)".*/\1/' || echo "")
if echo "$PLUGIN_ID" | grep -qi "obsidian"; then
  echo "FAIL: Plugin ID must not contain 'obsidian' (found: $PLUGIN_ID)"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: Plugin ID clean ($PLUGIN_ID)"
fi

# 10. Description must not contain "Obsidian"
PLUGIN_DESC=$(python3 -c "import json; print(json.load(open('manifest.json')).get('description',''))" 2>/dev/null || echo "")
if echo "$PLUGIN_DESC" | grep -q "Obsidian"; then
  echo "FAIL: Description should not contain 'Obsidian' (review bot flags this)"
  echo "  Current: $PLUGIN_DESC"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: Description does not contain 'Obsidian'"
fi

# 11. Description <= 250 characters
DESC_LEN=${#PLUGIN_DESC}
if [ "$DESC_LEN" -gt 250 ]; then
  echo "FAIL: Description too long ($DESC_LEN chars, max 250)"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: Description length OK ($DESC_LEN/250)"
fi

# 12. Description ends with period
if [ -n "$PLUGIN_DESC" ] && [[ ! "$PLUGIN_DESC" =~ \.\s*$ ]]; then
  echo "FAIL: Description must end with a period"
  echo "  Current: $PLUGIN_DESC"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: Description ends with period"
fi

# 13. minAppVersion is set
MIN_APP=$(grep -o '"minAppVersion":\s*"[^"]*"' manifest.json | sed 's/.*"\([^"]*\)".*/\1/' || echo "")
if [ -z "$MIN_APP" ]; then
  echo "FAIL: minAppVersion not set in manifest.json"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: minAppVersion set ($MIN_APP)"
fi

# 14. fundingUrl: absent or non-empty
FUNDING=$(grep -o '"fundingUrl":\s*"[^"]*"' manifest.json 2>/dev/null | sed 's/.*"\([^"]*\)".*/\1/' || echo "")
if grep -q '"fundingUrl"' manifest.json 2>/dev/null && [ -z "$FUNDING" ]; then
  echo "FAIL: fundingUrl is present but empty — remove it or add a valid URL"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: fundingUrl OK"
fi

echo
if [ "$ERRORS" -gt 0 ] || [ "$WARNINGS" -gt 0 ]; then
  echo "=== $ERRORS error(s), $WARNINGS warning(s) ==="
  [ "$ERRORS" -gt 0 ] && exit 1
  exit 0
else
  echo "=== All checks passed ==="
  exit 0
fi
