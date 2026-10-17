#!/bin/sh
# Update a self-hosted PocKeep to the latest commit on main.
#
#   /opt/pockeep/scripts/update.sh                     on the server itself
#   pct exec <CTID> -- /opt/pockeep/scripts/update.sh  from a Proxmox host
#
# Rebuilds only when there are new commits, because building the web app and
# the native SQLite bindings takes a few minutes on a small LXC.
set -e

# the repo root, wherever this clone happens to live
cd "$(dirname "$0")/.."

before=$(git rev-parse HEAD)
# --ff-only: a deployment checkout should fast-forward, never create a merge
git pull --ff-only --quiet
after=$(git rev-parse HEAD)

if [ "$before" = "$after" ]; then
  echo "PocKeep server is up to date ($(git rev-parse --short HEAD))."
  exit 0
fi

echo "Updating PocKeep $(git rev-parse --short "$before") -> $(git rev-parse --short "$after")"
git --no-pager log --oneline "$before..$after"

docker compose up -d --build
docker compose ps
