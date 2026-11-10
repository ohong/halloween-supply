#!/bin/sh
# Stop hook: the agent is not done until `bun run check` passes.
input=$(cat)
active=$(printf '%s' "$input" | bun -e 'const i = JSON.parse(await Bun.stdin.text()); console.log(i.stop_hook_active === true ? "1" : "")') || active=""
[ -n "$active" ] && exit 0
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0
out=$(bun run check 2>&1) && exit 0
echo "bun run check failed. Fix the errors below before stopping:" >&2
printf '%s\n' "$out" | tail -n 60 >&2
exit 2
