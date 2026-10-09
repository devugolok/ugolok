#!/usr/bin/env bash
# Публичное зеркало без истории: текущее дерево ветки (по умолчанию main) уходит
# в публичные репозитории ОДНИМ новым коммитом поверх предыдущего коммита зеркала.
# История рабочего репозитория (авторы, почты, часовой пояс) наружу не попадает:
# автор/коммитер — Ugolok <dev@ugolok.tech>, дата — UTC.
#
# Пуш — отдельным SSH-ключом зеркала (deploy key с правом записи в каждом
# зеркале), НЕ личным ключом разработчика: личный ключ привязан к личному
# аккаунту, и пуш им связал бы аккаунты на стороне площадки.
#
# usage: scripts/publish-mirror.sh [ref]          ref по умолчанию main
#   MIRROR_URLS     — адреса через пробел (по умолчанию публичное зеркало на GitHub).
#                     Codeberg не используем: его правила (§ 2 (1) 7) запрещают проекты,
#                     написанные в основном генеративными ИИ-инструментами.
#   MIRROR_SSH_KEY  — приватный ключ зеркала (по умолчанию ~/.ssh/ugolok_mirror_ed25519)
#   MIRROR_EXCLUDE  — пути, которых не должно быть в зеркале (через пробел)
#   MIRROR_DRY_RUN=1 — собрать коммит и показать, что ушло бы, без пуша
set -euo pipefail

REF="${1:-main}"
MIRROR_URLS="${MIRROR_URLS:-git@github.com:devugolok/ugolok.git}"
MIRROR_SSH_KEY="${MIRROR_SSH_KEY:-$HOME/.ssh/ugolok_mirror_ed25519}"
# PROCESS-DOCS — служебные заметки разработки (см. docs/RUNBOOK.md), не витрина.
MIRROR_EXCLUDE="${MIRROR_EXCLUDE:-PROCESS-DOCS}"
NAME="Ugolok"
EMAIL="dev@ugolok.tech"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { echo "publish-mirror: нет ref '$REF'" >&2; exit 1; }
if [[ "${MIRROR_DRY_RUN:-0}" != "1" && ! -f "$MIRROR_SSH_KEY" ]]; then
	echo "publish-mirror: нет ключа зеркала $MIRROR_SSH_KEY" >&2
	exit 1
fi
export GIT_SSH_COMMAND="ssh -i $MIRROR_SSH_KEY -o IdentitiesOnly=yes -o IdentityAgent=none"

# Дерево без исключённых путей — через временный индекс, рабочая копия не трогается.
TMP_INDEX="$(mktemp)"
trap 'rm -f "$TMP_INDEX"' EXIT
GIT_INDEX_FILE="$TMP_INDEX" git read-tree "$REF"
for path in $MIRROR_EXCLUDE; do
	GIT_INDEX_FILE="$TMP_INDEX" git rm -r -q --cached --ignore-unmatch -- "$path" >/dev/null
done
TREE="$(GIT_INDEX_FILE="$TMP_INDEX" git write-tree)"

VERSION="$(git describe --tags --always "$REF" 2>/dev/null || git rev-parse --short "$REF")"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

for url in $MIRROR_URLS; do
	parent="$(git ls-remote "$url" refs/heads/main 2>/dev/null | cut -f1 || true)"
	parent_args=()
	if [[ -n "$parent" ]]; then
		git fetch -q "$url" "refs/heads/main" 2>/dev/null || { echo "publish-mirror: $url — не удалось получить main" >&2; exit 1; }
		if [[ "$(git rev-parse "$parent^{tree}")" == "$TREE" ]]; then
			echo "publish-mirror: $url — без изменений"
			continue
		fi
		parent_args=(-p "$parent")
	fi
	commit="$(GIT_AUTHOR_NAME="$NAME" GIT_AUTHOR_EMAIL="$EMAIL" GIT_AUTHOR_DATE="$NOW" \
		GIT_COMMITTER_NAME="$NAME" GIT_COMMITTER_EMAIL="$EMAIL" GIT_COMMITTER_DATE="$NOW" \
		git commit-tree "$TREE" ${parent_args[@]+"${parent_args[@]}"} -m "Уголок $VERSION")"
	if [[ "${MIRROR_DRY_RUN:-0}" == "1" ]]; then
		echo "publish-mirror (dry run): $url <- $commit ($(git log -1 --format='%an <%ae> %ad %s' --date=iso-strict "$commit"))"
		continue
	fi
	git push -q "$url" "$commit:refs/heads/main"
	echo "publish-mirror: $url <- $commit (Уголок $VERSION)"
done
