#!/usr/bin/env bash
# Deploys only the Agent data-access files of CrossBorderOps to jennov-75.
# Run from the dingtalk-enterprise-agent repository root on a machine with SSH access.
#
# What it changes:
#   - apps/backend/services/agent_daily_metrics_service.py      (new: daily.metrics)
#   - apps/backend/services/agent_daily_aggregate_service.py    (snapshot rows no longer drop ASINs)
#   - apps/backend/services/agent_performance_change_service.py (same fix)
#   - apps/backend/api/agent_access_routes.py                   (routes daily.metrics; row datasets skip snapshots)
# It writes them into the project working tree (so the next image build includes them)
# and into the running crossborderops-backend container, then restarts that container.
# Other uncommitted work in the remote tree is left untouched; the image is not rebuilt.
set -euo pipefail

HOST="${HOST:-jennov@192.168.3.75}"
PROJECT="/home/jennov/projects/crossborderops-platform/apps/backend"
CONTAINER="crossborderops-backend"
FILES=(
  services/agent_daily_metrics_service.py
  services/agent_daily_aggregate_service.py
  services/agent_performance_change_service.py
  api/agent_access_routes.py
)
STAMP="$(date +%Y%m%d%H%M%S)"

for file in "${FILES[@]}"; do
  # Keep a backup of the current version next to the file before replacing it.
  ssh "$HOST" "test -f $PROJECT/$file && cp $PROJECT/$file $PROJECT/$file.bak-agent-$STAMP || true"
  ssh "$HOST" "cat > $PROJECT/$file" < "remote/apps/backend/$file"
  ssh "$HOST" "docker cp $PROJECT/$file $CONTAINER:/app/$file"
done

ssh "$HOST" "docker restart $CONTAINER >/dev/null && for i in \$(seq 1 30); do s=\$(docker inspect -f '{{.State.Health.Status}}' $CONTAINER); [ \"\$s\" = healthy ] && echo healthy && exit 0; sleep 2; done; echo 'backend not healthy'; exit 1"
echo "Deployed. Backups: *.bak-agent-$STAMP in $PROJECT"
echo "Rollback: restore the .bak-agent-$STAMP files, docker cp them into $CONTAINER:/app/, and restart $CONTAINER."
