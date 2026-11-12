#!/usr/bin/env bash
# Backs up the clinic database and the uploaded PDFs into deploy/backups/<date>/,
# keeping the newest 14 backups. Run it by hand or daily from cron (see DEPLOY.md).
set -euo pipefail
cd "$(dirname "$0")"

stamp="$(date +%Y-%m-%d_%H%M)"
dir="backups/$stamp"
mkdir -p "$dir"

docker compose exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --no-tablespaces --default-character-set=utf8mb4 doctor_clinic' \
  | gzip > "$dir/database.sql.gz"
docker compose exec -T backend tar -C /app/data -czf - uploads > "$dir/uploads.tar.gz"

ls -1d backups/*/ | sort | head -n -14 | xargs -r rm -rf
echo "Backup saved in deploy/$dir ($(du -sh "$dir" | cut -f1))"
