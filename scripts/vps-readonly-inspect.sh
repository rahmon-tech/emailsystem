#!/usr/bin/env bash
set -eu

DOMAIN="${1:-app.promptologoy.com}"
BASE_PATH="${2:-/emailblast}"
PORT="${3:-3087}"

case "$BASE_PATH" in
  ""|/*) ;;
  *)
    printf 'BASE_PATH must be empty or begin with /\n' >&2
    exit 2
    ;;
esac

case "$PORT" in
  ""|*[!0-9]*)
    printf 'PORT must be numeric\n' >&2
    exit 2
    ;;
esac

section() {
  printf '\n== %s ==\n' "$1"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

try() {
  label="$1"
  shift
  printf '%s\n' "-- $label"
  if ! "$@"; then
    printf '[warn] %s could not be completed with current permissions/environment\n' "$label"
  fi
}

service_state() {
  name="$1"
  if ! have systemctl; then
    return
  fi
  active="$(systemctl is-active "$name" 2>/dev/null || true)"
  enabled="$(systemctl is-enabled "$name" 2>/dev/null || true)"
  printf '%-12s active=%-10s enabled=%s\n' "$name" "${active:-unknown}" "${enabled:-unknown}"
}

http_code() {
  url="$1"
  if have curl; then
    curl --silent --show-error --location --max-time 10       --output /dev/null --write-out '%{http_code}' "$url" || printf 'unreachable'
  else
    printf 'curl-unavailable'
  fi
}

section "Identity"
printf 'utc_time=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'hostname=%s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'user=%s\n' "$(id -un 2>/dev/null || printf unknown)"
printf 'uid=%s\n' "$(id -u 2>/dev/null || printf unknown)"
printf 'domain=%s\nbase_path=%s\nloopback_port=%s\n' "$DOMAIN" "$BASE_PATH" "$PORT"

section "Operating system"
if [ -r /etc/os-release ]; then
  grep -E '^(NAME|VERSION|ID|VERSION_ID)=' /etc/os-release || true
fi
try "kernel" uname -a
if have uptime; then try "uptime" uptime; fi

section "Capacity"
if have free; then try "memory" free -h; fi
if have df; then try "root filesystem" df -h /; fi

section "Runtime tooling"
if have docker; then
  try "docker version" docker --version
  try "docker compose version" docker compose version
  try "compose projects" docker compose ls
  try "containers" docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
else
  printf 'docker=unavailable\n'
fi
if have node; then try "node version" node --version; else printf 'node=unavailable\n'; fi
if have pnpm; then try "pnpm version" pnpm --version; else printf 'pnpm=unavailable\n'; fi
if have nginx; then try "nginx version" nginx -v; else printf 'nginx=unavailable\n'; fi
if have caddy; then try "caddy version" caddy version; else printf 'caddy=unavailable\n'; fi

section "Service state"
for service in docker nginx caddy postgresql redis-server redis; do
  service_state "$service"
done

section "Listening TCP ports"
if have ss; then
  try "listeners" ss -ltn
  if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$PORT$"; then
    printf 'port_%s=occupied\n' "$PORT"
  else
    printf 'port_%s=free_or_not_visible\n' "$PORT"
  fi
else
  printf 'ss=unavailable\n'
fi

section "Existing proxy layout names"
if [ -d /etc/nginx/sites-enabled ]; then
  find /etc/nginx/sites-enabled -maxdepth 1 -mindepth 1 -printf '%f\n' 2>/dev/null | sort || true
fi
if [ -d /etc/nginx/conf.d ]; then
  find /etc/nginx/conf.d -maxdepth 1 -mindepth 1 -printf '%f\n' 2>/dev/null | sort || true
fi
if [ -d /etc/caddy ]; then
  find /etc/caddy -maxdepth 1 -mindepth 1 -printf '%f\n' 2>/dev/null | sort || true
fi

section "Prepared installation path"
if [ -e /opt/emailblast ]; then
  try "/opt/emailblast metadata" ls -ld /opt/emailblast
else
  printf '/opt/emailblast=absent\n'
fi

section "DNS"
if have getent; then
  try "resolved addresses" getent ahosts "$DOMAIN"
fi

section "Public HTTP status"
printf 'https://%s/ -> %s\n' "$DOMAIN" "$(http_code "https://$DOMAIN/")"
printf 'https://%s%s/ -> %s\n' "$DOMAIN" "$BASE_PATH" "$(http_code "https://$DOMAIN$BASE_PATH/")"
printf 'https://%s%s/health/live -> %s\n' "$DOMAIN" "$BASE_PATH" "$(http_code "https://$DOMAIN$BASE_PATH/health/live")"
printf 'https://%s%s/health/ready -> %s\n' "$DOMAIN" "$BASE_PATH" "$(http_code "https://$DOMAIN$BASE_PATH/health/ready")"

section "TLS certificate"
if have openssl; then
  if have timeout; then
    if cert="$(timeout 12 sh -c "printf '' | openssl s_client -servername '$DOMAIN' -connect '$DOMAIN:443' 2>/dev/null | openssl x509 -noout -subject -issuer -dates" 2>/dev/null)"; then
      printf '%s\n' "$cert"
    else
      printf '[warn] TLS certificate inspection failed\n'
    fi
  else
    printf 'timeout=unavailable; skipped TLS network probe\n'
  fi
else
  printf 'openssl=unavailable\n'
fi

section "Result"
printf 'Read-only inspection complete. No service, container, database, proxy configuration, credential file, or firewall state was changed.\n'
