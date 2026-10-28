import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('archive workflow preserves human edits, incrementally compiles and restores complete originals', () => {
  const result=spawnSync('python3',['workflows/activity-case-organizer/scripts/test_workflow.py'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
test('link capture, link matching and intake absorption tools keep their contracts', () => {
  const result=spawnSync('python3',['-m','unittest','discover','-s','tests'],{cwd:'workflows/activity-case-organizer',encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
