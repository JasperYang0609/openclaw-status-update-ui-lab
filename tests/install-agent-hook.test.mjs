import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-ui-hook-'));
const target = path.join(directory, 'AGENTS.md');
fs.writeFileSync(target, '# Existing rules\n');

try {
  for (let run = 0; run < 2; run += 1) {
    const result = spawnSync('python3', ['scripts/install_agent_hook.py', target], {
      cwd: path.resolve(new URL('..', import.meta.url).pathname),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const text = fs.readFileSync(target, 'utf8');
  assert.equal((text.match(/status-update-ui-lab:start/g) ?? []).length, 1);
  assert.match(text, /runtime attempts the initial progress card automatically/);
  assert.match(text, /Do not duplicate that initial card/);
  assert.match(text, /message bodies/);
  assert.doesNotMatch(text, /Every assistant turn, send at least one/);
  assert.match(text, /# Existing rules/);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log('install-agent-hook tests passed');
