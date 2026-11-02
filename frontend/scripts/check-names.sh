#!/usr/bin/env bash
# Undefined names crash the page on open.
# next.config ignores type errors at build (eighteen old strictness errors drop nothing), but one class is a confirmed break: "Cannot find name", an undefined identifier. Each such name makes a page show "Application error" as soon as it opens.
# This happened: two Arabic letters entered the middle of useLanguage in an open file, giving a name that is syntactically valid (Arabic is allowed in identifiers), so the build passed and the contracts page crashed. tsc saw it from the start but nobody read its full output.
# So this check reads only that class and fails if one exists.
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "TS2304|TS2552" || true)
if [ -n "$out" ]; then
  echo "✗ أسماءٌ غيرُ معرَّفة — كلُّ سطرٍ منها صفحةٌ تنهار عند فتحها:"
  echo "$out" | sed 's/^/   /'
  exit 1
fi
echo "✓ لا أسماءَ غيرَ معرَّفة"
