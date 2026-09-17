import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("VPS inspection script remains read-only and privacy bounded", async () => {
  const script = await readFile("scripts/vps-readonly-inspect.sh", "utf8");

  for (const forbidden of [
    /\bdocker\s+compose\s+(?:up|down|start|stop|restart|rm|build|pull)\b/i,
    /\bsystemctl\s+(?:start|stop|restart|reload|enable|disable)\b/i,
    /\b(?:rm|mv|cp|chmod|chown)\s+/i,
    /\bgit\s+(?:pull|checkout|reset|clean)\b/i,
    /\bprisma\b[^\n]*\bmigrate\b/i,
    /\b(?:ufw|iptables|nft)\s+/i,
    /\bdocker\s+inspect\b/i,
    /\bsh\s+-c\b/i,
    /\bcat\s+[^\n]*(?:\.env|nginx|caddy)/i,
  ]) {
    assert.doesNotMatch(script, forbidden);
  }

  assert.match(script, /docker compose ls/);
  assert.match(script, /docker ps --format/);
  assert.match(script, /ss -ltn/);
  assert.match(script, /health\/live/);
  assert.match(script, /health\/ready/);
  assert.match(script, /No service, container, database, proxy configuration, credential file, or firewall state was changed/);
});
