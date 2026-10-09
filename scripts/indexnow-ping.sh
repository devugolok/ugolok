#!/usr/bin/env bash
# IndexNow: после выкладки сообщить поисковикам, какие страницы изменились.
# Протокол открытый, аккаунт не нужен: владение сайтом подтверждает файл-ключ
# public/<KEY>.txt (лежит в корне сайта). Яндекс пересылает уведомление
# остальным участникам IndexNow (Bing и др.). Google протокол не поддерживает.
#
# Изменившиеся = адреса из sitemap.xml новой выкладки, чей файл отличается от
# снимка прежней (deploy-env.sh: www-prev-$ENV) или в снимке отсутствует. Главная
# (index.html с BUILD_HASH внутри) поэтому уходит при каждой выкладке — это один
# адрес, а справка — только когда правили её тексты.
#
# Никогда не валит выкладку: любой сбой — предупреждение и exit 0.
# usage: indexnow-ping.sh <www-dir> <prev-www-dir> <origin>
#   UGOLK_INDEXNOW_DRY_RUN=1 — только напечатать запрос, не отправлять.
set -uo pipefail

KEY="7a1c1741dd21c8ba7a53421d72d936ff"
ENDPOINT="https://yandex.com/indexnow"

WWW="${1:-}"
PREV="${2:-}"
ORIGIN="${3:-}"
ORIGIN="${ORIGIN%/}"
if [[ -z "$WWW" || -z "$ORIGIN" ]]; then
	echo "usage: $0 <www-dir> <prev-www-dir> <origin>" >&2
	exit 0
fi
if [[ ! -f "$WWW/sitemap.xml" ]]; then
	echo "indexnow: нет $WWW/sitemap.xml — пропускаю" >&2
	exit 0
fi
if [[ ! -f "$WWW/$KEY.txt" ]]; then
	echo "indexnow: нет файла-ключа $WWW/$KEY.txt — поисковик не подтвердит владение, пропускаю" >&2
	exit 0
fi

HOST="${ORIGIN#*://}"
changed=()
while IFS= read -r url; do
	path="${url#"$ORIGIN"}"
	path="${path#/}"
	[[ -z "$path" ]] && path="index.html"
	if [[ ! -f "$WWW/$path" ]]; then
		continue # адрес из sitemap без файла — не наш случай, не сообщаем о битом
	fi
	if [[ -n "$PREV" && -f "$PREV/$path" ]] && cmp -s "$WWW/$path" "$PREV/$path"; then
		continue
	fi
	changed+=("$url")
done < <(grep -oE '<loc>[^<]+</loc>' "$WWW/sitemap.xml" | sed -E 's#</?loc>##g')

if [[ ${#changed[@]} -eq 0 ]]; then
	echo "indexnow: изменений нет"
	exit 0
fi

list=""
for url in "${changed[@]}"; do
	list+="${list:+,}\"$url\""
done
payload="{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"$ORIGIN/$KEY.txt\",\"urlList\":[$list]}"

if [[ "${UGOLK_INDEXNOW_DRY_RUN:-0}" == "1" ]]; then
	echo "indexnow (dry run): ${#changed[@]} адрес(ов) -> $ENDPOINT"
	echo "$payload"
	exit 0
fi

code="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X POST \
	-H 'Content-Type: application/json; charset=utf-8' \
	--data "$payload" "$ENDPOINT" 2>/dev/null)" || code="curl-error"
case "$code" in
	200 | 202) echo "indexnow: отправлено ${#changed[@]} адрес(ов), ответ $code" ;;
	*) echo "indexnow: ВНИМАНИЕ — ответ '$code' (${#changed[@]} адрес(ов) не приняты), выкладка не затронута" >&2 ;;
esac
exit 0
