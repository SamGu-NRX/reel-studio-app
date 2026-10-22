'use strict';
class ScriptedProvider {
  id = 'fake'; model = 'scripted-engine-eval'; supportsImages = false;
  select(task) { this.task = task; this.turn = 0; }
  async complete(req) {
    const allowed = new Set(req.tools.map(t => t.name));
    const calls = this.task?.calls;
    if (!calls) throw new Error('harness must select a task before complete');
    const c = (name, args) => ({ id: `mock-${this.turn}-${name}`, name, args });
    if (this.turn++ === 0) return { text: '', toolCalls: [...calls.filter(x => allowed.has(x.name)).map(x => c(x.name, x.args)), c('finish', {summary_for_user: 'Applied the supplied script.'})] };
    return { text: '', toolCalls: [c('finish', {summary_for_user: 'Checked the supplied script.'})] };
  }
  dispose() {}
}
module.exports = {ScriptedProvider};
