import { describe, it, expect } from 'vitest';
import { createAI, Prompts } from '../src';
import { FakeHost, ScriptedModel, tmpDir } from './helpers';

const req = {
  caption: 'Hi guys, quick one today\nOne bowl, two folds.\n\n#sourdough',
  duration: 20,
  words: [{ w: 'Nobody', s: 0.4 }, { w: 'needs', s: 0.8 }, { w: 'a', s: 1.1 }, { w: 'mixer', s: 1.3 }],
  coverSeconds: 3,
};
const ai = (model: ScriptedModel) => createAI({ host: new FakeHost(tmpDir()), settingsDir: tmpDir(), providerOverride: model });

describe('proposeTry', () => {
  // fails if a proposal that changes nothing, or isn't the one thing the creator swapped to, reaches the app
  it('asks again until the editor changes one thing, and only the thing the creator chose', async () => {
    const model = new ScriptedModel([
      { text: '{"variable":"hook","value":"Hi guys, quick one today","reason":"I kept it."}' },
      { text: '{"variable":"hook","value":"Sourdough without a mixer, in one bowl","reason":"I lead with the topic, since your first line is a greeting."}' },
    ]);
    expect(await ai(model).proposeTry(req)).toEqual({ variable: 'hook', value: 'Sourdough without a mixer, in one bowl', reason: 'I lead with the topic, since your first line is a greeting.' });
    expect(model.requests[0].jsonOnly).toBe(true);
    expect(JSON.stringify(model.requests[1].messages)).toMatch(/same hook line as now/);

    const swapped = new ScriptedModel([
      { text: '{"variable":"hook","value":"Sourdough without a mixer","reason":"I lead with the topic."}' },
      { text: '{"variable":"cover","value":3.1,"reason":"I picked your smile."}' },
    ]);
    await expect(ai(swapped).proposeTry({ ...req, variable: 'cover' })).rejects.toMatchObject({ code: 'try_failed' });
    expect(JSON.stringify(swapped.requests[0].messages)).toMatch(/change the cover/);
    expect(JSON.stringify(swapped.requests[1].messages)).toMatch(/variable must be \\"cover\\"/);
  });

  it('needs a connected editor', async () => {
    await expect(createAI({ host: new FakeHost(tmpDir()), settingsDir: tmpDir() }).proposeTry(req)).rejects.toMatchObject({ code: 'no_ai' });
  });

  it('has a prompt in the editor\'s voice with no em dashes', () => {
    const t = new Prompts().raw('proposeTry');
    expect(t).toMatch(/"I"/);
    expect(t).not.toMatch(/—/);
  });
});
