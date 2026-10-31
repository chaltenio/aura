// Deploy counter: every deploy gets the next number (v1, v2, ...), shown in the home page footer and /api/version.
// The number lives in DATA_DIR/version.json on the Fly volume, so it survives restarts and later deploys.
// A deploy is a boot whose build differs from the last one: Fly gives every `fly deploy` (CI on main,
// scripts/deploy.sh, a rollback) a new FLY_IMAGE_REF, while a restart or a secrets change keeps it, so the number
// stays. Off Fly the git sha (APP_VERSION) stands in; a dev build (neither set) has no number.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function deployInfo(dataDir, env = process.env, now = Date.now()) {
  const version = env.APP_VERSION || 'dev';
  const build = env.FLY_IMAGE_REF || (version === 'dev' ? '' : version);
  if (!build) return { version, deploy: null, deployedAt: null };
  const file = join(dataDir, 'version.json');
  let last = {};
  try { last = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const prev = Number.isInteger(last.deploy) ? last.deploy : 0;
  if (prev && last.build === build) return { version, deploy: prev, deployedAt: last.deployedAt ?? null };
  const next = { deploy: prev + 1, build, version, deployedAt: now };
  try { writeFileSync(file, JSON.stringify(next)); } catch (e) { console.warn(`could not write ${file}: ${e.message}`); }
  return { version, deploy: next.deploy, deployedAt: now };
}
