#!/bin/bash
# NUR AUF DEM MAC AUSFÜHREN (nicht auf debian!)
# Doppelklick oder: ./kopiere-lib-zum-server.sh

SERVER="jochen@192.168.222.131"
ZIEL="/opt/ioBroker.beregnungswerk/lib"
QUELLE="$(cd "$(dirname "$0")/lib" && pwd)"

echo "Kopiere von Mac:"
echo "  $QUELLE"
echo "nach Server:"
echo "  $SERVER:$ZIEL"
echo ""

scp "$QUELLE/stateDefinitions.js" "$QUELLE/constants.js" "$SERVER:$ZIEL/"

echo ""
echo "Fertig. Auf dem Server prüfen:"
echo "  ls -la /opt/ioBroker.beregnungswerk/lib/"
echo "  cd /opt/iobroker && ./iobroker restart beregnungswerk.0"
