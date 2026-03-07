#!/usr/bin/env bash
# ============================================
# GITHUB — Git & GitHub operations wrapper
# Reads credentials from .env
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

# --- Load .env ---
load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "[ ENV NOT FOUND ] — .env file missing" >&2
    exit 1
  fi

  # Export only the tokens we need, nothing else leaks
  GITHUB_TOKEN=$(grep '^GITHUB_TOKEN=' "$ENV_FILE" | cut -d= -f2)
  GITHUB_OWNER=$(grep '^GITHUB_OWNER=' "$ENV_FILE" | cut -d= -f2)
  GITHUB_REPO=$(grep '^GITHUB_REPO=' "$ENV_FILE" | cut -d= -f2)

  if [[ -z "$GITHUB_TOKEN" ]]; then
    echo "[ ENV INVALID ] — GITHUB_TOKEN is empty" >&2
    exit 1
  fi

  export GH_TOKEN="$GITHUB_TOKEN"
}

# --- Commands ---

cmd_push() {
  local branch="${1:-$(git branch --show-current)}"
  echo "[ GITHUB ] Pushing branch: $branch"
  git push -u origin "$branch"
}

cmd_push_force() {
  local branch="${1:-$(git branch --show-current)}"
  echo "[ GITHUB ] Force pushing branch: $branch"
  git push --force-with-lease origin "$branch"
}

cmd_pr_create() {
  local title="${1:?Usage: github.sh pr-create <title>}"
  shift
  echo "[ GITHUB ] Creating PR: $title"
  load_env
  gh pr create --title "$title" "$@"
}

cmd_pr_edit() {
  local pr="${1:?Usage: github.sh pr-edit <number> [gh flags...]}"
  shift
  echo "[ GITHUB ] Editing PR #$pr"
  load_env
  gh pr edit "$pr" "$@"
}

cmd_pr_list() {
  load_env
  gh pr list "$@"
}

cmd_pr_view() {
  local pr="${1:?Usage: github.sh pr-view <number>}"
  shift
  load_env
  gh pr view "$pr" "$@"
}

cmd_pr_close() {
  local pr="${1:?Usage: github.sh pr-close <number> [gh flags...]}"
  shift
  echo "[ GITHUB ] Closing PR #$pr"
  load_env
  gh pr close "$pr" "$@"
}

cmd_pr_checks() {
  local pr="${1:?Usage: github.sh pr-checks <number>}"
  load_env
  gh pr checks "$pr"
}

cmd_status() {
  load_env
  echo "[ GITHUB ] Repository: $GITHUB_OWNER/$GITHUB_REPO"
  echo "[ GITHUB ] Branch: $(git branch --show-current)"
  echo "[ GITHUB ] ENV: valid"
  gh repo view "$GITHUB_OWNER/$GITHUB_REPO" --json name,defaultBranchRef --jq '"[ GITHUB ] Default branch: " + .defaultBranchRef.name'
  echo ""
  gh pr list --limit 5
}

# --- Issues ---

cmd_issue_create() {
  local title="${1:?Usage: github.sh issue-create <title> [-l label] [-b body]}"
  shift
  echo "[ GITHUB ] Creating issue: $title"
  load_env
  gh issue create --title "$title" "$@"
}

cmd_issue_list() {
  load_env
  gh issue list "$@"
}

cmd_issue_view() {
  local number="${1:?Usage: github.sh issue-view <number>}"
  shift
  load_env
  gh issue view "$number" "$@"
}

cmd_issue_close() {
  local number="${1:?Usage: github.sh issue-close <number>}"
  shift
  echo "[ GITHUB ] Closing issue #$number"
  load_env
  gh issue close "$number" "$@"
}

# --- Labels ---

cmd_label_create() {
  local name="${1:?Usage: github.sh label-create <name> [--description text] [--color hex]}"
  shift
  echo "[ GITHUB ] Creating label: $name"
  load_env
  gh label create "$name" "$@"
}

cmd_label_list() {
  load_env
  gh label list "$@"
}

# --- Rulesets ---

cmd_ruleset_apply() {
  local ruleset_file="$PROJECT_ROOT/scripts/ruleset-main.json"
  if [[ ! -f "$ruleset_file" ]]; then
    echo "[ GITHUB ] Ruleset file not found: $ruleset_file" >&2
    exit 1
  fi

  load_env
  echo "[ GITHUB ] Deleting existing rulesets..."
  local ids
  ids=$(gh api "repos/$GITHUB_OWNER/$GITHUB_REPO/rulesets" --jq '.[].id' 2>/dev/null || true)
  for id in $ids; do
    gh api "repos/$GITHUB_OWNER/$GITHUB_REPO/rulesets/$id" --method DELETE 2>/dev/null || true
    echo "[ GITHUB ] Deleted ruleset #$id"
  done

  echo "[ GITHUB ] Applying ruleset from $ruleset_file"
  gh api "repos/$GITHUB_OWNER/$GITHUB_REPO/rulesets" --method POST --input "$ruleset_file" --jq '"[ GITHUB ] Applied: " + .name + " (ID: " + (.id | tostring) + ")"'
}

cmd_ruleset_check() {
  load_env
  echo "[ GITHUB ] Active rulesets:"
  gh api "repos/$GITHUB_OWNER/$GITHUB_REPO/rulesets" --jq '.[] | "  #" + (.id | tostring) + " " + .name + " [" + .enforcement + "]"'
}

# --- Help ---

cmd_help() {
  cat <<'HELP'
GITHUB — Git & GitHub operations wrapper

Usage: scripts/github.sh <command> [args...]

Commands:
  push [branch]                 Push branch to remote
  push-force [branch]           Force push with lease
  pr-create <title> [flags]     Create pull request
  pr-edit <number> [flags]      Edit pull request
  pr-list [flags]               List pull requests
  pr-view <number> [flags]      View pull request
  pr-close <number> [flags]     Close pull request
  pr-checks <number>            View PR check status
  issue-create <title> [flags]  Create issue (-l label, -b body)
  issue-list [flags]            List issues
  issue-view <number> [flags]   View issue
  issue-close <number> [flags]  Close issue
  label-create <name> [flags]   Create label (--description, --color)
  label-list [flags]            List labels
  status                        Repository status
  ruleset-apply                 Restore rulesets from scripts/ruleset-main.json
  ruleset-check                 Show active rulesets
  help                          This message

All GitHub commands read credentials from .env.
HELP
}

# --- Router ---

command="${1:-help}"
shift || true

case "$command" in
  push)        cmd_push "$@" ;;
  push-force)  cmd_push_force "$@" ;;
  pr-create)   cmd_pr_create "$@" ;;
  pr-edit)     cmd_pr_edit "$@" ;;
  pr-list)     cmd_pr_list "$@" ;;
  pr-view)     cmd_pr_view "$@" ;;
  pr-close)       cmd_pr_close "$@" ;;
  pr-checks)      cmd_pr_checks "$@" ;;
  issue-create)   cmd_issue_create "$@" ;;
  issue-list)     cmd_issue_list "$@" ;;
  issue-view)     cmd_issue_view "$@" ;;
  issue-close)    cmd_issue_close "$@" ;;
  label-create)   cmd_label_create "$@" ;;
  label-list)     cmd_label_list "$@" ;;
  ruleset-apply)  cmd_ruleset_apply "$@" ;;
  ruleset-check)  cmd_ruleset_check "$@" ;;
  status)         cmd_status "$@" ;;
  help|--help) cmd_help ;;
  *)
    echo "[ GITHUB ] Unknown command: $command" >&2
    cmd_help
    exit 1
    ;;
esac
