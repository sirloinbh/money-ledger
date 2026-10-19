import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffSkills, syncSkills } from '../claude-skills.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-skills-'));
  const source = path.join(dir, 'skills');
  fs.mkdirSync(path.join(source, 'demo/references'), { recursive: true });
  fs.writeFileSync(path.join(source, 'demo/SKILL.md'), '---\nname: demo\n---\nBody\n');
  fs.writeFileSync(path.join(source, 'demo/references/notes.md'), 'Notes\n');
  return { dir, source, target: path.join(dir, 'claude') };
}

test('sync copies every skill file including references', (t) => {
  const { dir, source, target } = fixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(diffSkills(source, target), [
    'missing: demo/SKILL.md',
    'missing: demo/references/notes.md',
  ]);
  syncSkills(source, target);
  assert.deepEqual(diffSkills(source, target), []);
  assert.equal(fs.readFileSync(path.join(target, 'demo/references/notes.md'), 'utf8'), 'Notes\n');
});

test('check reports changed and extra files and sync removes stale copies', (t) => {
  const { dir, source, target } = fixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  syncSkills(source, target);
  fs.writeFileSync(path.join(source, 'demo/SKILL.md'), '---\nname: demo\n---\nUpdated\n');
  fs.mkdirSync(path.join(target, 'removed'));
  fs.writeFileSync(path.join(target, 'removed/SKILL.md'), 'old');
  assert.deepEqual(diffSkills(source, target), [
    'changed: demo/SKILL.md',
    'extra: removed/SKILL.md',
  ]);
  syncSkills(source, target);
  assert.deepEqual(diffSkills(source, target), []);
  assert.equal(fs.existsSync(path.join(target, 'removed')), false);
});

test('line endings alone are not reported as drift', (t) => {
  const { dir, source, target } = fixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  syncSkills(source, target);
  fs.writeFileSync(path.join(target, 'demo/SKILL.md'), '---\r\nname: demo\r\n---\r\nBody\r\n');
  assert.deepEqual(diffSkills(source, target), []);
});

test('repository Claude skills match the Codex project skills', () => {
  assert.deepEqual(diffSkills(path.join(root, 'skills'), path.join(root, '.claude/skills')), []);
});
