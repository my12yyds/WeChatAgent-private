import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importDshPlugin, importPlan, importFailure, executeImport } from './import-dsh-plugin.mjs';
import { taskFailureMessage } from './console-process.mjs';
import { createConsole } from './console-server.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechatgirl-import 测试 & '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'));
  const source = new URL('../packages/dsh-social-bridge-plugin/', import.meta.url);
  fs.cpSync(source, path.join(root, 'packages/dsh-social-bridge-plugin'), { recursive: true, filter: file => !file.split(path.sep).includes('node_modules') });
  const executable = path.join(root, 'DSH/DeepSeek Harness.exe');
  const launcher = path.join(root, 'DSH/resources/runtime/cli/bin/dsh.cmd');
  fs.mkdirSync(path.dirname(launcher), { recursive: true });
  fs.writeFileSync(executable, 'fixture only');
  fs.writeFileSync(launcher, '"%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*');
  return { root, executable, launcher, patchFile: path.join(root, 'packages/dsh-social-bridge-plugin/cordis.patch.yml') };
}

test('official command uses argv for paths with spaces and shell characters and retains the correct DSH home', t => {
  const f = fixture(t);
  const env = { DSH_HOME: 'inherited', NODE_OPTIONS: '--bad', TEST: 'kept' };
  const spec = importPlan(f.root, f.executable, env);
  assert.equal(spec.exe, f.executable);
  assert.deepEqual(spec.args.slice(2), ['plugin', '--profile', 'desktop', 'add', path.join(f.root, 'packages/dsh-social-bridge-plugin')]);
  assert.equal(spec.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(spec.env.NODE_OPTIONS, undefined);
  assert.equal(env.NODE_OPTIONS, '--bad');
  fs.writeFileSync(path.join(f.root, 'config/distribution.json'), JSON.stringify({ dsh: f.executable, dshHome: 'retained-home' }));
  assert.equal(importPlan(f.root, f.executable, env).env.DSH_HOME, 'retained-home');
  fs.writeFileSync(path.join(f.root, 'config/distribution.json'), JSON.stringify({ dsh: 'other.exe', dshHome: 'unrelated-home' }));
  assert.equal(importPlan(f.root, f.executable, env).env.DSH_HOME, 'inherited');
});

test('missing or unsupported DSH and running DSH fail before changing plugin files', async t => {
  const f = fixture(t), before = fs.readFileSync(f.patchFile, 'utf8');
  assert.throws(() => importPlan(f.root, ''), { code: 'DSH_NOT_CONFIGURED' });
  await assert.rejects(importDshPlugin({ ...f, probe: async () => true, execute: () => assert.fail('must not execute') }), { code: 'DSH_IMPORT_RUNNING' });
  fs.unlinkSync(f.launcher);
  assert.throws(() => importPlan(f.root, f.executable), { code: 'DSH_IMPORT_UNSUPPORTED' });
  assert.equal(fs.readFileSync(f.patchFile, 'utf8'), before);
});

test('import fixes only the bundled patch and can be repeated without duplicate entries', async t => {
  const f = fixture(t), messages = [];
  let calls = 0;
  const execute = async spec => { calls++; assert.equal(spec.args.at(-1), path.dirname(f.patchFile)); return { code: 0, output: '' }; };
  for (let i = 0; i < 2; i++) assert.equal((await importDshPlugin({ ...f, probe: async () => false, execute, onProgress: text => messages.push(text) })).imported, true);
  const patch = fs.readFileSync(f.patchFile, 'utf8');
  assert.equal(calls, 2);
  assert.match(patch, /wechatagent=[a-f0-9]{16}/);
  assert(!patch.includes('PATH/TO/WeChatAgent'));
  assert.equal((patch.match(/id: dsh-social-bridge-plugin/g) || []).length, 1);
  assert(messages.at(-1).includes('是否连接成功以实际检查为准'));
});

test('failures keep compatibility checks and return actionable messages without raw diagnostic output', async t => {
  const f = fixture(t);
  const cases = [['incompatible-version allow-version', /不兼容/], ['Open DeepSeek Harness Desktop once to initialize its profile', /初始化/], ['file lock EBUSY', /退出 DSH/], ['ENOTFOUND registry', /网络/]];
  for (const [output, expected] of cases) {
    assert.match(importFailure(output, 1), expected);
    await assert.rejects(importDshPlugin({ ...f, probe: async () => false, execute: async () => ({ code: 1, output }) }), expected);
  }
  assert.match(importFailure('', 124), /检查是否已导入/);
  assert.equal(taskFailureMessage('[DSH_IMPORT_RUNNING] 请先退出 DSH。', 1), '请先退出 DSH。');
});

test('the import child process has a bounded timeout', async () => {
  const result = await executeImport({ exe: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], env: process.env }, { timeoutMs: 80 });
  assert.equal(result.code, 124);
});

test('console dispatch requires its token and only schedules the fixed importer', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'roles'));
  fs.copyFileSync(new URL('../config/wechatagent.example.json', import.meta.url), path.join(f.root, 'config/wechatagent.example.json'));
  let invoked;
  const app = createConsole({ root: f.root, port: 0, runner: async spec => { invoked = spec; return 0; } });
  const address = await app.start(); t.after(() => app.close());
  const base = `http://127.0.0.1:${address.port}`;
  const packageCatalog = await fetch(base + '/packages/plugin-api/bundled.mjs');
  assert.equal(packageCatalog.status, 200);
  assert.match(await packageCatalog.text(), /BUNDLED_PLUGINS/);
  const browserContract = await fetch(base + '/plugin-contract.mjs');
  assert.equal(browserContract.status, 200);
  assert.match(await browserContract.text(), /packages\/plugin-api\/bundled\.mjs/);
  const { token } = await fetch(base + '/api/info').then(r => r.json());
  const request = headers => fetch(base + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ action: 'dsh-plugin-import', args: ['untrusted-argument'] }) });
  assert.equal((await request({})).status, 401);
  assert.equal((await request({ 'x-console-token': token })).status, 202);
  assert.deepEqual(invoked.args, [path.join(f.root, 'scripts/import-dsh-plugin.mjs')]);
  assert.equal(invoked.timeoutMs, 240000);
});
