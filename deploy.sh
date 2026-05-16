#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="afl-predictions-jc"
ZONE="australia-southeast1-a"
VM_NAME="afl-predictions-vm"
REMOTE_APP_DIR="/var/www/afl-predictions"
DOMAIN="https://afl.jcx.au"

fail() {
  echo "deploy.sh: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

require_command git
require_command gcloud

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not inside a git worktree"

branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "main" ]] || fail "deploys must run from main, not $branch"

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  fail "worktree has uncommitted changes"
fi

echo "Fetching origin/main..."
git fetch origin main

local_sha="$(git rev-parse HEAD)"
origin_sha="$(git rev-parse origin/main)"
merge_base="$(git merge-base HEAD origin/main)"

if [[ "$local_sha" == "$origin_sha" ]]; then
  echo "origin/main already has $local_sha"
elif [[ "$merge_base" == "$origin_sha" ]]; then
  echo "Pushing main to origin..."
  git push origin main
elif [[ "$merge_base" == "$local_sha" ]]; then
  fail "local main is behind origin/main; pull or rebase before deploying"
else
  fail "local main and origin/main have diverged"
fi

deploy_command="cd $REMOTE_APP_DIR && git pull origin main && docker compose down && docker compose build && docker compose up -d && echo HEAD=\$(git rev-parse --short HEAD)"
verify_command="cd $REMOTE_APP_DIR && echo HEAD=\$(git rev-parse --short HEAD) && docker ps --format \"table {{.Names}}\\t{{.Status}}\" | sed -n \"1,10p\""

echo "Deploying to $VM_NAME..."
gcloud compute ssh "$VM_NAME" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --command "$deploy_command"

echo "Verifying remote container state..."
gcloud compute ssh "$VM_NAME" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --command "$verify_command"

if command -v curl >/dev/null 2>&1; then
  echo "Smoke checking $DOMAIN..."
  curl -fsS -o /dev/null -w "HTTP %{http_code}\n" "$DOMAIN"
fi
