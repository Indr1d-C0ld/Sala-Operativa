#!/usr/bin/env bash
# =============================================================================
# Balthasar — prepara l'ospitalita' di Sala Operativa (una volta sola, da root).
#
#   sudo bash ~/Claude/balthasar-salaoperativa/installa.sh
#
# Crea /var/www/html/sala-operativa di randolph:www-data e installa la
# configurazione di Apache con autoprova; se la prova fallisce torna indietro.
# (Copia di deploy/installa-balthasar.sh del repository Sala-Operativa.)
# =============================================================================
set -euo pipefail
[[ $EUID -eq 0 ]] || exec sudo bash "$0" "$@"
SRC="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
WEB=/var/www/html/sala-operativa
CONF=/etc/apache2/conf-available/sala-operativa.conf

echo "== cartella del sito =="
install -d -o randolph -g www-data -m 2775 "$WEB"
ls -ld "$WEB" | awk '{print "   " $1, $3":"$4, $NF}'

echo "== configurazione di Apache =="
PRIMA=""
[[ -f $CONF ]] && { PRIMA=$(mktemp); cp "$CONF" "$PRIMA"; }
install -o root -g root -m 0644 "$SRC/apache-sala-operativa.conf" "$CONF"
a2enconf -q sala-operativa
if apache2ctl configtest 2>&1 | grep -q "Syntax OK"; then
  systemctl reload apache2
  echo "   sala-operativa.conf attiva, Apache ricaricato"
else
  apache2ctl configtest || true
  if [[ -n $PRIMA ]]; then cp "$PRIMA" "$CONF"; else a2disconf -q sala-operativa; rm -f "$CONF"; fi
  echo "!! prova di Apache fallita: configurazione ritirata, niente ricaricato" >&2
  exit 1
fi
