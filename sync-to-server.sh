#!/bin/bash
# Synchronisiert lokales Projekt → ioBroker-Server
# Nutzung auf dem Mac: ./sync-to-server.sh

SERVER="jochen@192.168.222.131"
REMOTE="/opt/ioBroker.beregnungswerk"
LOCAL="$(cd "$(dirname "$0")" && pwd)"

echo "=== Sync: $LOCAL → $SERVER:$REMOTE ==="

rsync -av \
  --exclude node_modules \
  --exclude .git \
  --exclude .DS_Store \
  --exclude admin/build \
  --exclude admin/.watch \
  "$LOCAL/" "$SERVER:$REMOTE/"

echo ""
echo "=== Upload & Neustart auf Server ==="
ssh "$SERVER" "cd /opt/iobroker && ./iobroker upload beregnungswerk && ./iobroker restart beregnungswerk.0"

echo ""
echo "=== Sync abgeschlossen ==="
