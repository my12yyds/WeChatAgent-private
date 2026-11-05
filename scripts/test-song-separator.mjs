import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('separator memory policy survives model load failures and recognizes native allocation errors',()=>{
  const result=spawnSync(process.env.WECHATAGENT_TEST_PYTHON??'python',['-B',fileURLToPath(new URL('./test-song-separator.py',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
});
