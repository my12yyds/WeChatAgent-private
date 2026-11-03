import {speechModelField,speechProtocolField,speechDiagnosticsMarkup,bindSpeechSettings} from './speech-settings.mjs';
import {PERMISSION_LABELS,FEATURE_LABELS,BUILTIN_PLUGIN_PACKAGES} from './plugin-contract.mjs';
const permissions=PERMISSION_LABELS;
export function pluginCard(item,esc,icon){
  return `<article class="extension-tile plugin-tile" data-plugin-card="${esc(item.id)}"><div class="extension-tile-top"><div><h2><button class="extension-title" data-plugin-settings="${esc(item.id)}">${esc(item.name)}</button></h2></div><button class="button extension-card-action" data-plugin-settings="${esc(item.id)}">配置</button></div><p class="extension-byline">${icon('plug')}<span>${esc(item.author||'本机插件')} · v${esc(item.version??'?')}</span></p><p class="extension-card-state"><span class="status-tag ${esc(item.statusTone)}">${esc(item.statusLabel)}</span><span>${item.chats===null?'所有允许的聊天':(item.chats??[]).length+' 个聊天'}</span></p><p class="extension-card-description">${esc(item.description)}</p>${item.serviceStatus?'<p class="speech-card-status"><span class="status-tag '+(['ok','error','warning','pending'].includes(item.serviceStatus.state)?item.serviceStatus.state:'pending')+'">'+esc(item.serviceStatus.label)+'</span><small>'+esc(item.serviceStatus.message)+'</small></p>':''}<div class="extension-card-tags"><span>WeChatGirl 插件</span><span>API v2</span></div><footer class="extension-card-footer"><small>${esc(item.reason)}</small>${item.id==='persona-studio'?'<button class="button small" data-persona-studio>打开工作室</button>':''}<button class="text-link" data-plugin-uninstall="${esc(item.id)}">卸载</button></footer></article>`;
}
export function createPluginUI({api,modal,closeModal,confirmAction,escapeHtml:esc,state,renderPage,toast,icon}){
  let sequence=0,ticket=null;
  const names=key=>state.names.get(key)??key;
  function installMarkup(catalog){if(catalog.pluginError)return `<p class="inline-error" role="alert">${esc(catalog.pluginError)} 内置能力继续可用。</p>`;return catalog.canInstallZip?`<section class="plugin-install-entry" id="plugin-install-entry" aria-label="安装 WeChatGirl 插件"><div><strong>${icon('plug')} 把新功能放进来</strong><p>拖入 ZIP 插件，或选择文件安装。安装后可单独选择聊天与权限。</p><details class="builtin-plugin-packages"><summary>WeChatGirl 内置插件包 · ${BUILTIN_PLUGIN_PACKAGES.length} 个</summary><div>${BUILTIN_PLUGIN_PACKAGES.map(item=>`<a class="text-link" href="/plugin-packages/${esc(item.id)}.zip" download="${esc(item.id+'-'+item.version+'.zip')}">${esc(item.name)} v${esc(item.version)}</a>`).join('')}</div><small>下载后从上方导入；默认不会安装或启用。</small></details></div><div class="plugin-install-actions"><button class="button primary" data-plugin-install>安装 ZIP 插件</button><a class="text-link" href="/plugin-api.md" download="WeChatGirl-plugin-api-v2.md" aria-label="下载插件开发规范 Markdown">开发规范</a><a class="text-link" href="/plugin-example.zip" download="chat-notes-1.0.0.zip">示例 ZIP</a></div></section>`:'';}
  async function page(){
    const catalog=await api('/api/plugins'),items=catalog.plugins??[];
    const chats=['group','private'].flatMap(kind=>(state.config.wechat.whitelist[kind==='group'?'groups':'private']??[]).map(value=>({key:'wechat:'+kind+':'+value,kind,name:names('wechat:'+kind+':'+value)})));
    const selected=chats.find(chat=>chat.key===state.pluginChat)??chats[0];state.pluginChat=selected?.key;
    const cards=items.map(item=>{const missing=(item.requestedPermissions??[]).some(value=>!item.permissions.includes(value)),checked=!!selected&&(item.chats===null||item.chats?.includes(selected.key));return '<article class="plugin-assignment-row"><label class="plugin-assignment-toggle"><input type="checkbox" data-plugin-for-chat="'+esc(item.id)+'" '+(checked?'checked':'')+' '+(!selected||item.invalid||missing?'disabled':'')+'><span><strong>'+esc(item.name)+'</strong><small>'+esc(item.description??'')+'</small><small>'+(missing?'需要先授权插件权限':item.enabled?'插件已启用':'总开关关闭，勾选后启用')+'</small></span></label><button class="button small" data-plugin-settings="'+esc(item.id)+'">参数与群聊管理</button></article>';}).join('');
    return '<section class="plugin-scope-intro"><div><h2>按聊天选择插件</h2><p>选择群聊或好友，在同一页勾选要使用的插件，修改后自动保存。</p></div><a class="button" href="#extensions/catalog">插件目录</a></section><section class="card"><div class="field"><label for="plugin-chat-picker">当前聊天</label><select id="plugin-chat-picker">'+chats.map(chat=>'<option value="'+esc(chat.key)+'" '+(chat.key===selected?.key?'selected':'')+'>'+esc((chat.kind==='group'?'群聊 · ':'好友 · ')+chat.name)+'</option>').join('')+'</select></div><p id="plugin-assignment-feedback" class="subtle" role="status"></p><div class="plugin-assignment-list">'+(cards||'<p>请先从能力目录安装插件。</p>')+'</div>'+(!chats.length?'<p class="notice">请先在聊天页面添加允许的群聊或好友。</p><a class="button" href="#chats">管理聊天</a>':'')+'</section>';
  }
  const error=message=>{const field=document.querySelector('#plugin-install-error');if(field)field.textContent=message;else toast(message);};
  function installDialog(file){
    sequence++;if(ticket)api('/api/plugins/cancel',{ticket}).catch(()=>{});ticket=null;
    modal('安装 WeChatGirl 插件',`<p class="modal-description">适用于遵循 WeChatGirl API v2 的插件。DSH 插件仍在 DSH 中安装。</p><label class="plugin-dropzone" id="plugin-dropzone" for="plugin-zip"><strong>将一个 ZIP 文件拖到这里</strong><span>或点击选择文件 · 最多 8 MiB</span><input id="plugin-zip" type="file" accept=".zip,application/zip" aria-label="选择 ZIP 插件"></label><div id="plugin-install-preview" aria-live="polite"></div><p id="plugin-install-error" class="inline-error" role="alert"></p><div class="modal-actions"><button class="button" data-close>取消</button><button class="button primary" id="plugin-install-confirm" disabled>确认安装</button></div>`,{onClose:()=>{sequence++;if(ticket)api('/api/plugins/cancel',{ticket}).catch(()=>{});ticket=null;}});
    document.querySelector('#plugin-zip').addEventListener('change',event=>inspect(event.target.files[0]));
    document.querySelector('#plugin-install-confirm').addEventListener('click',async event=>{
      const preview=document.querySelector('#plugin-install-preview'),replace=preview.querySelector('#plugin-replace');
      if(replace&&!replace.checked){error('请先确认更新同名插件，或取消安装。');return;}
      const button=event.currentTarget;button.disabled=true;
      try{await api('/api/plugins/install',{ticket,revision:preview.dataset.revision,replace:!!replace?.checked});ticket=null;closeModal();await renderPage();toast('插件已安装，尚未启用。点击插件“配置”选择聊天和权限。');}
      catch(cause){error(cause.message);button.disabled=false;}
    });
    if(file)inspect(file);
  }
  async function inspect(file){
    if(!file)return;
    const button=document.querySelector('#plugin-install-confirm'),preview=document.querySelector('#plugin-install-preview');button.disabled=true;preview.textContent='正在检查插件…';error('');
    if(!file.name.toLowerCase().endsWith('.zip')||file.size>8*1024*1024){preview.textContent='';error('请选择不超过 8 MiB 的 ZIP 文件。');return;}
    if(ticket){api('/api/plugins/cancel',{ticket}).catch(()=>{});ticket=null;}
    const request=++sequence;
    try{
      const zip=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('无法读取 ZIP 文件。'));reader.readAsDataURL(file);});
      const result=await api('/api/plugins/inspect',{name:file.name,zip});
      if(sequence!==request){api('/api/plugins/cancel',{ticket:result.ticket}).catch(()=>{});return;}
      ticket=result.ticket;preview.dataset.revision=result.revision;
      preview.innerHTML=`<section class="plugin-preview"><h3>${esc(result.plugin.name)} <small>v${esc(result.plugin.version)}</small></h3><p>${esc(result.plugin.description)}</p><small>${esc(result.plugin.id)} · ${result.files} 个文件 · ${Math.ceil(result.bytes/1024)} KiB</small><h4>申请的能力</h4><ul>${result.plugin.permissions.length?result.plugin.permissions.map(value=>`<li>${esc(permissions[value])}</li>`).join(''):'<li>不申请额外宿主权限</li>'}</ul><p class="subtle">安装阶段不会运行代码。插件启用后会执行本地 JavaScript，请只启用信任的来源。</p>${result.installedVersion?`<label class="extension-option"><input id="plugin-replace" type="checkbox">更新已有 v${esc(result.installedVersion)}，保留数据并归档旧代码；更新后需重新启用。</label>`:''}</section>`;
      button.textContent=result.installedVersion?'确认更新':'确认安装';button.disabled=false;
    }catch(cause){if(sequence===request){preview.textContent='';error(cause.message);}}
  }
  async function settings(id){
    try{
      const catalog=await api('/api/plugins'),item=catalog.plugins.find(item=>item.id===id);if(!item)throw Error('插件已变化，请刷新列表。');
      const chats=['private','group'].flatMap(kind=>(state.config.wechat.whitelist[kind==='group'?'groups':'private']??[]).map(value=>'wechat:'+kind+':'+value));
      const isSpeech=item.id==='speech-recognition';let speechBinding;
      const renderField=([key,schema],index)=>{
        const value=item.settings[key]??schema.default??'',field='plugin-setting-'+index,label=esc(schema.title??key),attr=`id="${field}" data-plugin-setting="${esc(key)}"`;
        if(isSpeech&&key==='model')return speechModelField({attr,field,label,value,esc});
        if(isSpeech&&key==='apiProtocol')return speechProtocolField({attr,field,schema,value,esc});
        if(schema.type==='boolean')return `<label class="extension-option"><input ${attr} type="checkbox" ${value?'checked':''}>${label}</label>`;
        if(schema.enum)return `<div class="field"><label for="${field}">${label}</label><select ${attr}>${schema.enum.map((option,n)=>`<option value="${n}" ${option===value?'selected':''}>${esc(option)}</option>`).join('')}</select></div>`;
        if(['object','array'].includes(schema.type))return `<div class="field"><label for="${field}">${label}（JSON）</label><textarea ${attr}>${esc(JSON.stringify(value,null,2))}</textarea></div>`;
        return `<div class="field"><label for="${field}">${label}</label><input ${attr} type="${schema.secret?'password':['integer','number'].includes(schema.type)?'number':'text'}" value="${esc(value)}" ${schema.secret?'placeholder="留空保留已保存值" autocomplete="off"':''}><small>${esc(schema.description??'')}</small></div>`;
      };
      const basic=new Set(['apiProtocol','endpoint','apiKey','model','language','audioFormat','autoReadModels']);
      const rows=Object.entries(item.configSchema).map((entry,index)=>({key:entry[0],html:renderField(entry,index)}));
      const settingsMarkup=isSpeech?'<div class="form-grid">'+rows.filter(row=>basic.has(row.key)).map(row=>row.html).join('')+'</div>'+speechDiagnosticsMarkup(item.serviceStatus,esc)+'<details class="speech-advanced"><summary>高级请求与模型列表设置</summary><div class="form-grid">'+rows.filter(row=>!basic.has(row.key)).map(row=>row.html).join('')+'</div></details>':'<div class="form-grid">'+rows.map(row=>row.html).join('')+'</div>';
      modal(item.name,`<form id="plugin-settings-form"><p class="modal-description">${esc(item.reason)}。保存后在空闲时或下一轮聊天加载；首次使用 API v2 需重开 DSH。允许哪些聊天使用，请在插件与聊天页面单独选择。</p><label class="extension-option"><input id="plugin-enabled" type="checkbox" ${item.enabled?'checked':''} ${item.invalid?'disabled':''}>允许此插件运行（仅启用信任的代码）</label><fieldset class="extension-fieldset"><legend>授权能力</legend>${item.requestedPermissions.map(value=>`<label class="extension-option"><input name="plugin-permission" type="checkbox" value="${esc(value)}" ${item.permissions.includes(value)?'checked':''}>${esc(permissions[value])}</label>`).join('')||'<p class="subtle">不需要额外权限。</p>'}</fieldset><fieldset class="extension-fieldset"><legend>插件群聊与好友管理</legend>${chats.map(key=>`<label class="extension-option"><input name="plugin-chat" type="checkbox" value="${esc(key)}" ${item.chats===null||item.chats?.includes(key)?'checked':''}>${esc(names(key))}</label>`).join('')||'<p>请先添加允许的聊天。</p>'}</fieldset>${settingsMarkup}<p class="inline-error" id="plugin-settings-error" role="alert"></p><div class="modal-actions"><button class="button" type="button" data-close>取消</button><button class="button primary" type="submit">保存插件设置</button></div></form>`,{onClose:()=>speechBinding?.dispose()});
      const form=document.querySelector('#plugin-settings-form');
      const readValues=()=>{const values={...item.settings};for(const input of form.querySelectorAll('[data-plugin-setting]')){const schema=item.configSchema[input.dataset.pluginSetting];values[input.dataset.pluginSetting]=schema.enum?schema.enum[Number(input.value)]:schema.type==='boolean'?input.checked:['object','array'].includes(schema.type)?JSON.parse(input.value):['integer','number'].includes(schema.type)?Number(input.value):input.value;}return values;};
      if(isSpeech)speechBinding=bindSpeechSettings({form,api:(route,body,options)=>api(route,body,true,options),item,revision:catalog.revision,readValues,esc});
      form.addEventListener('submit',async event=>{event.preventDefault();speechBinding?.cancel();const button=event.submitter??form.querySelector('[type="submit"]');button.disabled=true;
        try{
          const values=readValues();
          await api('/api/plugins/'+item.id,{revision:catalog.revision,enabled:form.querySelector('#plugin-enabled').checked,permissions:[...form.querySelectorAll('[name="plugin-permission"]:checked')].map(input=>input.value),chats:[...form.querySelectorAll('[name="plugin-chat"]:checked')].map(input=>input.value),settings:values});closeModal();await renderPage();toast('插件设置已保存。');
        }catch(cause){form.querySelector('#plugin-settings-error').textContent=cause.message;button.disabled=false;}
      });
    }catch(cause){toast(cause.message);}
  }
  document.addEventListener('click',async event=>{
    const scopeAction=event.target.closest('[data-scope-select]');if(scopeAction){const form=document.querySelector('#plugin-scope-form');for(const input of form?.querySelectorAll('[name="plugin-scope-chat"]')??[])input.checked=scopeAction.dataset.scopeSelect==='all';form?.querySelector('#plugin-scope-selected-count')?.replaceChildren(String(form.querySelectorAll('[name="plugin-scope-chat"]:checked').length));return;}
    const button=event.target.closest('[data-plugin-install],[data-plugin-settings],[data-plugin-uninstall]');if(!button)return;
    if(button.hasAttribute('data-plugin-install'))installDialog();
    if(button.dataset.pluginSettings)settings(button.dataset.pluginSettings);
    if(button.dataset.pluginUninstall){const id=button.dataset.pluginUninstall;const catalog=await api('/api/plugins').catch(()=>null);if(!catalog)return toast('无法读取插件列表，请重试。');confirmAction('卸载插件','插件代码会归档，保存的数据保留。','卸载',async()=>{try{await api('/api/plugins/'+id+'/uninstall',{revision:catalog.revision});await renderPage();toast('插件已卸载，数据已保留。');}catch(cause){toast(cause.message);}});}
  });
  document.addEventListener('change',async event=>{
    if(event.target.id==='plugin-chat-picker'){state.pluginChat=event.target.value;await renderPage();return;}
    const input=event.target.closest('[data-plugin-for-chat]');if(!input)return;
    const key=state.pluginChat,desired=input.checked;input.disabled=true;const feedback=document.querySelector('#plugin-assignment-feedback');if(feedback)feedback.textContent='正在保存…';
    try{const catalog=await api('/api/plugins'),item=catalog.plugins.find(item=>item.id===input.dataset.pluginForChat);if(!item)throw Error('插件已变化，请刷新。');const all=['private','group'].flatMap(kind=>(state.config.wechat.whitelist[kind==='group'?'groups':'private']??[]).map(value=>'wechat:'+kind+':'+value)),chats=new Set(item.chats===null?all:(item.chats??[]));if(desired)chats.add(key);else chats.delete(key);await api('/api/plugins/'+item.id,{revision:catalog.revision,enabled:item.enabled||desired,permissions:item.permissions,chats:[...chats],settings:item.settings});if(feedback)feedback.textContent='已保存，本聊天的插件范围已更新。';}catch(error){input.checked=!desired;if(feedback)feedback.textContent=error.message;}finally{input.disabled=false;}
  });
  document.addEventListener('change',event=>{if(!event.target.matches('#plugin-scope-form [name="plugin-scope-chat"]'))return;const count=document.querySelector('#plugin-scope-selected-count');if(count)count.textContent=String(document.querySelectorAll('#plugin-scope-form [name="plugin-scope-chat"]:checked').length);});
  document.addEventListener('submit',async event=>{const form=event.target.closest('#plugin-scope-form');if(!form)return;event.preventDefault();const button=form.querySelector('[type="submit"]'),id=location.hash.replace(/^#plugins\//,'').split('/')[0];button.disabled=true;try{const catalog=await api('/api/plugins'),item=catalog.plugins.find(value=>value.id===id);if(!item)throw Error('插件已变化，请刷新页面。');const chats=[...form.querySelectorAll('[name="plugin-scope-chat"]:checked')].map(input=>input.value);await api('/api/plugins/'+id,{revision:catalog.revision,enabled:item.enabled||chats.length>0,permissions:item.permissions??[],chats,settings:item.settings??{}});await renderPage();toast('插件可用聊天已保存。');}catch(cause){form.querySelector('#plugin-scope-error').textContent=cause.message;button.disabled=false;}});
  document.addEventListener('dragover',event=>{if(event.dataTransfer?.types?.includes('Files')&&(document.querySelector('#plugin-install-entry')||document.querySelector('#plugin-dropzone'))){event.preventDefault();document.querySelector('#plugin-install-entry')?.classList.add('is-dragover');}});
  document.addEventListener('dragleave',event=>{if(!event.relatedTarget)document.querySelector('#plugin-install-entry')?.classList.remove('is-dragover');});
  document.addEventListener('drop',event=>{if(!document.querySelector('#plugin-install-entry')&&!document.querySelector('#plugin-dropzone'))return;event.preventDefault();document.querySelector('#plugin-install-entry')?.classList.remove('is-dragover');const files=event.dataTransfer?.files;if(files?.length!==1)return toast('一次拖入一个 ZIP 插件即可。');installDialog(files[0]);});
  return {installMarkup,settings,installDialog,page};
}
