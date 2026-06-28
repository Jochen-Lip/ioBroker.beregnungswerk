#!/bin/bash
# Holt aktuellen Stand vom Server → lokales GitHub-Backup
# Nutzung auf dem Mac: ./sync-from-server.sh

SERVER="jochen@192.168.222.131"
REMOTE="/opt/ioBroker.beregnungswerk"
LOCAL="$(cd "$(dirname "$0")" && pwd)"

echo "=== Sync: $SERVER:$REMOTE → $LOCAL ==="

rsync -av \
  --exclude node_modules \
  --exclude .git \
  --exclude .DS_Store \
  --exclude admin/build \
  --exclude admin/.watch \
  "$SERVER:$REMOTE/" "$LOCAL/"

echo ""
echo "=== Backup abgeschlossen ==="
