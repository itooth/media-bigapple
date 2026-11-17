import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('activity-case-organizer: archive, checks, repair, posters, links and publish keep their contracts', () => {
  const result=spawnSync('python3',['-m','unittest','discover','-s','tests'],{cwd:'workflows/activity-case-organizer',encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
