import test from 'node:test';
import assert from 'node:assert/strict';
import { removalInclude, nsisString } from './windows-installer-policy.mjs';
import { singleDirectoryTemplate } from './installer-directory-page.mjs';

test('uninstall deletes only recorded files and removes directories only when empty',()=>{
  const script=removalInclude(['WeChatGirl.exe','resources/app/main.cjs','resources/project/docs/安装说明.md']);
  assert.match(script,/Delete "\$INSTDIR\\resources\\app\\main.cjs"/);
  assert.ok(script.indexOf('RMDir "$INSTDIR\\resources\\app"') < script.indexOf('RMDir "$INSTDIR\\resources"'));
  assert.doesNotMatch(script,/RMDir\s+\/r|Delete\s+[^\n]*\*/i);
  assert.doesNotMatch(script,/storage\.ini|\\data\\/i);
});
test('unsafe paths and user data cannot become uninstall instructions',()=>{
  for(const file of ['../data/account.json','C:/data/a','/absolute/a','x/../../a','x//a','storage.ini','STORAGE.INI','data/a','x\na','x"a']) assert.throws(()=>removalInclude([file]));
  assert.equal(nsisString('a$b"c'),'a$$b$\\"c');
});
test('directory template refuses changed upstream structure instead of silently misplacing app/data',()=>{
  assert.throws(()=>singleDirectoryTemplate('changed upstream template'));
  const output=singleDirectoryTemplate('    !insertmacro MUI_PAGE_DIRECTORY\n    Function instFilesPre\n old\n    FunctionEnd');
  assert.match(output,/MUI_DIRECTORYPAGE_VARIABLE \$WcaRoot/);
  assert.match(output,/Call WcaStoragePreInstall/);
});
