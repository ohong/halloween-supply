#!/bin/sh
# PostToolUse hook: lint the file the agent just edited. Exit 2 shows eslint output to the agent.
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
file=$(bun -e 'const i = JSON.parse(await Bun.stdin.text()); console.log(i.tool_input?.file_path ?? "")') || exit 0
case "$file" in
  "$root"/.claude/*) exit 0 ;;
  "$root"/*.ts|"$root"/*.tsx|"$root"/*.js|"$root"/*.mjs) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0
cd "$root" || exit 0
out=$(bunx eslint --no-warn-ignored "$file" 2>&1) && exit 0
printf '%s\n' "$out" >&2
exit 2
