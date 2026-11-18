#!/usr/bin/env bash
# =============================================================================
# Sala Operativa — build sotto /sala-operativa/ e pubblicazione su Balthasar.
#
#   bash deploy/pubblica.sh            # build + rsync
#   bash deploy/pubblica.sh --prova    # solo build e rsync a secco (--dry-run)
#
# Gli scenari (packages/app/public/scenarios/) non sono nel repository: se mancano
# si rigenerano con `npm run scenari`.
# Prima volta: la cartella e la configurazione di Apache le prepara
#   sudo bash ~/Claude/balthasar-salaoperativa/installa.sh   (su Balthasar)
# =============================================================================
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

HOST=${SO_HOST:-balthasar}
DEST=${SO_DEST:-/var/www/html/sala-operativa}
BASE=${SO_BASE:-/sala-operativa/}
URL=${SO_URL:-https://timrouter.dns.army/sala-operativa/}
DIST=packages/app/dist
DRY=""; [[ ${1:-} == --prova ]] && DRY="--dry-run"

n=$(ls packages/app/public/scenarios/*.json 2>/dev/null | wc -l)
[[ $n -ge 37 ]] || { echo "!! mancano gli scenari ($n su 37): npm run scenari" >&2; exit 1; }

echo "== build (base $BASE) =="
npx tsc -b
npx vite build packages/app --base "$BASE" --logLevel warn

VERSION=$(node -p "require('./packages/app/package.json').version")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
SPORCO=$([[ -n $(git status --porcelain 2>/dev/null) ]] && echo true || echo false)
cat > "$DIST/version.json" <<JSON
{"name":"Sala Operativa","version":"$VERSION","commit":"$COMMIT","dirty":$SPORCO,"built":"$(date -Iseconds)"}
JSON
echo "   versione $VERSION ($COMMIT$([[ $SPORCO == true ]] && echo ', modifiche non committate'))"

echo "== rsync verso $HOST:$DEST =="
rsync -rltz --delete --delay-updates $DRY \
  --chmod=D2775,F0664 \
  --exclude '.DS_Store' \
  "$DIST/" "$HOST:$DEST/"

[[ -n $DRY ]] && exit 0
echo "== verifica =="
# il sito è privato: da fuori deve chiedere la password (401); la versione si legge sul server
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
ver=$(ssh "$HOST" cat "$DEST/version.json" | node -pe 'JSON.parse(require("fs").readFileSync(0)).commit' 2>/dev/null || echo "?")
echo "   $URL → HTTP $code (atteso 401, accesso riservato), commit pubblicato $ver"
[[ $code == 401 && $ver == "$COMMIT" ]]
