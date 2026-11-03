import test from 'node:test';
import assert from 'node:assert/strict';
import {draftIssue,draftMarkdown,studioChats} from '../public/console/persona-studio-model.mjs';
import {markdown} from '../optional-extensions/persona-studio/lib/studio.mjs';
const draft={display_name:'小星',description:'温柔的音乐搭子',system_prompt:'你是小星，温柔但有主见，回答简短自然，喜欢音乐，并尊重彼此的互动边界。',examples:[{role:'user',content:'今天有点累。'},{role:'assistant',content:'先歇会儿，要不要一起听首歌？'}]};
test('browser exports match plugin Markdown and reject incomplete or unsafe edits',()=>{
  assert.equal(draftIssue(draft),'');assert.equal(draftMarkdown(draft),markdown(draft));
  for(const bad of [{...draft,display_name:'CON'},{...draft,display_name:'../x'},{...draft,system_prompt:'短'},{...draft,examples:[{role:'user',content:''}]}])assert(draftIssue(bad));
  assert.throws(()=>draftMarkdown({...draft,system_prompt:''}));
});
test('workshop only offers conversations granted to the installed plugin',()=>{
  const config={wechat:{whitelist:{private:['123','456'],groups:['789']}}};
  const plugin={enabled:true,permissions:['storage','model_generate'],chats:['wechat:private:123','wechat:private:999']};
  assert.deepEqual(studioChats(config,plugin),['wechat:private:123']);
  assert.deepEqual(studioChats(config,{...plugin,enabled:false}),[]);
  assert.deepEqual(studioChats(config,{...plugin,permissions:['storage']}),[]);
});
