import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('WeChat settings storage parents resolve only bounded known directories and retain account readiness',()=>{
 const result=spawnSync(process.env.WECHATAGENT_TEST_PYTHON??'python',['-B',fileURLToPath(new URL('./test-reader-discovery.py',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
});
