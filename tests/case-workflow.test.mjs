import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('archive workflow preserves human edits, incrementally compiles and restores complete originals', () => {
  const result=spawnSync('python3',['workflows/case-collection-workflow/scripts/test_workflow.py'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
