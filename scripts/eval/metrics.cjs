'use strict';
function instrument(agent, tools) {
  let current = null;
  const run = agent.runAgent, execute = tools.executeTool;
  agent.runAgent = async o => {
    const m = current, started = performance.now();
    try {
      const r = await run({...o, onEvent: e => { if (e.type === 'status' && e.message === 'The AI is busy, trying again') m.retries++; o.onEvent(e); }});
      m.agentRuns.push({steps: r.steps, stoppedBy: r.stoppedBy, effectiveTokens: r.tokens, wallMs: performance.now() - started});
      if (r.stoppedBy !== 'finish') m.stoppedByCaps++;
      return r;
    } catch(e) {if(e.code==='token_budget')m.stoppedByCaps++; m.agentRuns.push({error: String(e.code || e.message), wallMs: performance.now()-started}); throw e; }
  };
  tools.executeTool = async (...args) => {
    const m = current, r = await execute(...args);
    m.toolCalls++;
    if (r.isError) {let body;try{body=JSON.parse(r.content);}catch{body={error:r.content};}const item={name:args[1],reason:body.error||r.content,code:body.code||null};if(!body.code&&!item.reason.startsWith(args[1]+' failed:'))m.validationErrors.push(item);else m.executionErrors.push(item);}
    return r;
  };
  return {
    start(id) { current = {id, modelTurns: 0, parseFailures: 0, emptyToolReplies: 0, retries: 0, toolCalls: 0, validationErrors: [], executionErrors: [], stoppedByCaps: 0, reportedTokens: null, reportedUsage: [], providerErrors: [], agentRuns: []}; return current; },
    wrap(provider) {
      return {id: provider.id, model: provider.model, supportsImages: provider.supportsImages,
        dispose: () => provider.dispose?.(),
        async complete(req) {
          const m = current; m.modelTurns++;
          try {
            const r = await provider.complete(req);
            if (r.malformed) m.parseFailures++;
            if (!r.toolCalls?.length) m.emptyToolReplies++;
            if (r.usage && ['totalTokens','input','output'].some(k=>Number.isFinite(r.usage[k]))) { m.reportedUsage.push(r.usage); m.reportedTokens = (m.reportedTokens ?? 0) + (Number.isFinite(r.usage.totalTokens)?r.usage.totalTokens:(Number.isFinite(r.usage.input)?r.usage.input:0)+(Number.isFinite(r.usage.output)?r.usage.output:0)); }
            return r;
          } catch (e) { m.providerErrors.push({code: e.code || null, message: String(e.userMessage || e.message || e)}); if(/quota|usage[_ .-]?limit|cli_limited|insufficient[_ .-]?credit/i.test(String(e.code||'')+' '+String(e.userMessage||e.message||'')))e.retryable=false;throw e; }
        }
      };
    }
  };
}
module.exports = {instrument};
