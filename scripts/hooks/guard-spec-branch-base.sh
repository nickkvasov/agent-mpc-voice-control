#!/usr/bin/env bash
# PreToolUse(Bash) guard enforcing Constitution XV's base-branch rule.
#
# Spec Kit's git extension creates a feature branch with `git checkout -b` from whatever is
# currently checked out. It has no base-branch option and no config key for one, so standing on an
# unlanded feature branch silently chains the new spec onto it — and a dependent branch inherits
# every one of its ancestor's migrations. This hook is the enforcement the tooling lacks.
#
# Denies ONLY the Spec Kit feature-branch script. Every other Bash call passes untouched.
# Fails OPEN on any unexpected condition (no jq, not a repo, unreadable payload): a guard that
# blocks all shell access when its own environment is odd is worse than the gap it closes.
#
# Escape hatch: AMR_ALLOW_DEPENDENT_SPEC=1 permits an intentional dependent chain, which XV allows
# when the new spec genuinely depends on unlanded work — name the dependency in the plan's
# prerequisites.
set -uo pipefail

BASE_BRANCH="develop"

payload=$(cat 2>/dev/null || true)
command -v jq >/dev/null 2>&1 || exit 0

cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0

# Only the branch-creating script is in scope.
case "$cmd" in
  *create-new-feature-branch*|*speckit.git.feature*) ;;
  *) exit 0 ;;
esac

# Deliberate dependent chain — the operator has opted in.
[ -n "${AMR_ALLOW_DEPENDENT_SPEC:-}" ] && exit 0

current=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
[ -n "$current" ] || exit 0
[ "$current" = "$BASE_BRANCH" ] && exit 0

reason="Constitution XV: a spec's feature branch must be cut from \`${BASE_BRANCH}\`, but HEAD is \`${current}\`. Spec Kit's branch script runs \`git checkout -b\` from HEAD, so this would chain the new spec onto ${current} and inherit its migrations. Run \`git switch ${BASE_BRANCH}\` and retry. If this dependent chain is intentional (XV permits it for a genuine dependency), re-run with AMR_ALLOW_DEPENDENT_SPEC=1 set and name the dependency in the plan's prerequisites."

jq -n --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
