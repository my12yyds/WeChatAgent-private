const {withoutSocialTools,canonicalSocialTools,withoutDshIdentity}=await import(new URL('./social-tool-policy.mjs'+new URL(import.meta.url).search,import.meta.url));
import { WEB_READER_POLICY } from './web-reader-policy.mjs';
import {MODEL_SEARCH_POLICY} from './model-search.mjs';
import {FILE_TRANSFER_POLICY} from './file-transfers.mjs';
import {ASSISTANT_ACCESS} from './assistant-policy.mjs';
import {DSH_ACCESS_POLICY} from './dsh-access.mjs';
import {MEME_LIBRARY_POLICY} from './meme-library-policy.mjs';
import {MEMBER_MEMORY_POLICY} from './member-memory-policy.mjs';
import {HISTORY_POLICY} from './history-policy.mjs';
export const name = 'social-tool-restrict';
export const inject = ['tools'];
const toolPolicies = (agentCtx,fallback) => [Symbol.for('wechatagent.extension-tools.v1'),WEB_READER_POLICY,MODEL_SEARCH_POLICY,DSH_ACCESS_POLICY,FILE_TRANSFER_POLICY,MEME_LIBRARY_POLICY,MEMBER_MEMORY_POLICY,HISTORY_POLICY]
  .map(symbol => agentCtx?.[symbol]??fallback?.[symbol]).filter(Boolean);
const assistantAllowed=agentCtx=>{try{return agentCtx?.[ASSISTANT_ACCESS]?.()!==false;}catch{return false;}};
const allowedNames=(agentCtx,policies=toolPolicies(agentCtx))=>new Set(assistantAllowed(agentCtx)?policies.flatMap(policy=>[...policy.names()]):[]);
const approvedSchemas=(schemas,names)=>canonicalSocialTools(schemas.filter(tool=>names.has(tool.name)).map(({deferLoading,...tool})=>tool));
const presentationBound=new WeakSet();

// Current DSH adds tool schemas after the prompt-presentation waterfall.
// Keep the selected executor and its approval pipeline, filtering only the
// tool declarations produced for this agent.
export function bindScopedToolPresentation(agent){
  const ctx=agent.ctx,tools=ctx.tools;
  if(presentationBound.has(ctx)||typeof tools?.selectExecutor!=='function'||typeof tools.setExecutor!=='function')return;
  const executor=tools.selectExecutor(agent);
  tools.setExecutor({
    sections:executor.sections,
    describe(definitions){
      const names=allowedNames(ctx),approved=definitions.filter(tool=>names.has(tool.name));
      const description=executor.describe(approved);
      const schemas=approvedSchemas(description.schemas,names);
      return {...description,schemas,knownNames:schemas.map(tool=>tool.name)};
    },
    execute:input=>executor.execute(input),
  });
  presentationBound.add(ctx);
}
export function apply(ctx) {
  const marker=Symbol.for('wechatagent.scoped-tool-guard.v1');if(Object.hasOwn(ctx,marker))return;Object.defineProperty(ctx,marker,{value:true,configurable:true});
  ctx.tools.presentAs?.('native'); // Visibility and execution use the same live per-chat authorization below.
  const policies=agent=>toolPolicies(agent?.ctx,ctx);
  ctx.tools.guard(exec => assistantAllowed(exec?.agent?.ctx)&&policies(exec?.agent).some(policy => policy.check(exec?.name)) ? undefined : '微信群友会话不允许调用未授权工具');
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const original=withoutDshIdentity(await next());
    const assembly=original.sections?.some(section=>section.name==='dsh-expression:companion')?{...original,sections:original.sections.filter(section=>section.name!=='dsh-expression:companion')}:original;
    if(!Array.isArray(assembly.tools))return assembly;
    const names=allowedNames(context?.scope?.ctx,policies(context?.scope));
    return names.size?{...assembly,tools:approvedSchemas(assembly.tools,names)}:withoutSocialTools(assembly);
  }, { prepend: true });
}
