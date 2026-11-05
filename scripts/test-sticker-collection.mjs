import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateStickerSettings} from '../components/qq-bridge/src/core/sticker-policy.js';

test('intake switches independently accept all boolean combinations and reject non-booleans',()=>{
 for(const collectEnabled of [false,true])for(const collectDshEnabled of [false,true])assert.doesNotThrow(()=>validateStickerSettings({collectEnabled,collectDshEnabled}));
 assert.doesNotThrow(()=>validateStickerSettings({collectGroups:false}));
 for(const collectDshEnabled of ['false',0,null])assert.throws(()=>validateStickerSettings({collectDshEnabled}));
});
test('real collection, DSH temporary resources, full-pool review and revocation use isolated synthetic images',()=>{
 const result=spawnSync(process.env.WECHATAGENT_TEST_PYTHON??'python',['-B',fileURLToPath(new URL('./test-sticker-collection.py',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);
});
