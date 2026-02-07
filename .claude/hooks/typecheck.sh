#!/bin/bash
# Post-edit hook: run lint + type-check after TypeScript edits
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only check TypeScript files
[[ "$FILE_PATH" =~ \.(ts|tsx)$ ]] || exit 0

# Run linter from project root
cd "$CLAUDE_PROJECT_DIR"
LINT_OUT=$(pnpm run lint 2>&1)
LINT_EXIT=$?

# Find nearest tsconfig.json (package boundary) for scoped type-check
DIR=$(dirname "$FILE_PATH")
while [ "$DIR" != "/" ] && [ ! -f "$DIR/tsconfig.json" ]; do
  DIR=$(dirname "$DIR")
done

TSC_OUT=""
if [ -f "$DIR/tsconfig.json" ]; then
  TSC_OUT=$(cd "$DIR" && pnpm exec tsc --noEmit --pretty 2>&1)
fi

# Report any issues
[ $LINT_EXIT -ne 0 ] && echo "=== Lint errors ===" && echo "$LINT_OUT" | head -30
[ -n "$TSC_OUT" ] && echo "=== Type errors ===" && echo "$TSC_OUT" | head -30
exit 0
