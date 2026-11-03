import test from 'node:test';
import assert from 'node:assert/strict';
import {needsDshSetup,needsWeChatRepair} from '../public/console/process-recovery.js';
import {taskFailureMessage} from './console-process.mjs';

test('DSH failures direct users to DSH settings, while hook and port failures retain their recovery', () => {
  for (const output of ['DSH_PLUGIN_NOT_READY: Enable the local plugin', 'DSH_NOT_CONFIGURED', '[DSH_IMPORT_RUNNING] 请退出 DSH', '[DSH_IMPORT_UNSUPPORTED] 请升级 DSH', 'ACCOUNT_SWITCH_REQUIRES_DSH_RESTART']) {
    assert.equal(needsDshSetup(output), true);
    assert.equal(needsWeChatRepair(output), false);
  }
  assert.equal(needsDshSetup('SERVICE_PORT_IN_USE service=adapter port=8766'), false);
  assert.equal(needsDshSetup('HOOK_NOT_LISTENING'), false);
  assert.equal(needsWeChatRepair('HOOK_NOT_LISTENING'), true);
  assert.match(taskFailureMessage('DSH_PLUGIN_NOT_READY', 1), /相同组件 ID/);
});
