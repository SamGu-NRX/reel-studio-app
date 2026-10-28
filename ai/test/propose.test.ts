import { describe, it, expect } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { checkReelProposal, createAI, loadProject, type ProposeReelsRequest, type Transcript, type Word } from '../src';
import { FakeHost, ScriptedModel, call, makeProject, tmpDir } from './helpers';

// About 60 words with punctuation and one 1.4 s pause, which is the only thing ending the fifth sentence.
const SENTENCES = [
  'Most people fold the dough too early.', //            w0-w6
  'That is the whole problem.', //                       w7-w11
  'Wait until it jiggles before the first fold.', //     w12-w19
  'Then fold it four times, an hour apart.', //          w20-w27
  'The crumb opens because the gluten had time', //      w28-w35, then the pause
  'I sold my mixer in March.', //                        w36-w41
  'Here is what changed.', //                            w42-w45
  'My hands do the work now, and the bread is better.', // w46-w56
  'Nobody needs a mixer for this.', //                   w57-w62
];

/** Every word lasts `long` s with 0.3 s before it (1.4 s before w36). gapCap 0.25 caps each gap, so a range of n
 * words plays for n * long + (n - 1) * 0.25 s. */
function fixture(long = 0.4, text = SENTENCES): Transcript {
  const words: Word[] = [];
  let t = 0;
  for (const w of text.join(' ').split(' ')) {
    t += words.length === 36 ? 1.4 : 0.3;
    words.push({ id: `w${words.length}`, source: 's1', s: t, e: t + long, w });
    t += long;
  }
  return { words };
}

const req = (over: Partial<ProposeReelsRequest> = {}): ProposeReelsRequest =>
  ({ transcript: fixture(), gapCap: 0.25, title: 'Sourdough notes', taken: [], ...over });
const reel = (title: string, keep: [string, string][], hook: [string, string] = [keep[0][0], keep[0][0]], extra: Record<string, unknown> = {}) =>
  ({ title, hook: { from: hook[0], to: hook[1] }, keep: keep.map(([from, to]) => ({ from, to })), why: 'I kept the fix and its reason, which stands on its own.', ...extra });
const reply = (...candidates: object[]) => ({ text: JSON.stringify({ candidates, notes: '' }) });
const problems = (j: unknown, r = req()) => {
  const out = checkReelProposal(j, r);
  return 'problems' in out ? out.problems.join('\n') : '';
};
const ai = (model?: ScriptedModel) => createAI({ host: new FakeHost(tmpDir()), settingsDir: tmpDir(), providerOverride: model });

const CRUMB: [string, string] = ['w0', 'w35']; // 36 words: 23.15 s
const MIXER: [string, string] = ['w36', 'w62']; // 27 words: 17.3 s

describe('proposeReels', () => {
  // fails if two proposed reels may share words, which would make the same lines twice
  it('refuses two reels that share a word, naming both, and takes the corrected reply', async () => {
    const model = new ScriptedModel([
      reply(reel('The one fold that fixed my crumb', [CRUMB]), reel('Why I stopped using a mixer', [['w28', 'w62']])),
      reply(reel('The one fold that fixed my crumb', [CRUMB]), reel('Why I stopped using a mixer', [MIXER])),
    ]);
    const got = await ai(model).proposeReels(req());
    expect(got.attempts).toBe(2);
    expect(got.candidates.map((c) => [c.id, c.keep])).toEqual([['r1', [{ from: 'w0', to: 'w35' }]], ['r2', [{ from: 'w36', to: 'w62' }]]]);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0].jsonOnly).toBe(true);
    const asked = JSON.stringify(model.requests[1].messages.at(-1));
    expect(asked).toMatch(/r2: keep\[0\] \(w28\.\.w62\) uses w28, which r1 uses \(w0\.\.w35\)/);
  });

  // fails if a reel may open or end mid-sentence, or if a transcript with no punctuation and no pause can never pass
  it('refuses a range that starts mid-sentence, naming the word, unless nothing marks sentences', () => {
    const late = { candidates: [reel('The one fold that fixed my crumb', [['w1', 'w35']], ['w1', 'w6'])] };
    expect(problems(late)).toMatch(/r1: keep\[0\] starts at w1 \("people"\), in the middle of a sentence/);
    const unmarked = fixture(0.4, SENTENCES.map((s) => s.replace(/[.,]/g, '')));
    unmarked.words.forEach((w, i) => { if (i) { w.s = unmarked.words[i - 1].e + 0.3; w.e = w.s + 0.4; } });
    expect(problems(late, req({ transcript: unmarked }))).toBe('');
  });

  // fails if the card shows the editor's own guess of a reel's length instead of the length its words play for
  it('measures each reel from its words and ignores the seconds in the reply', async () => {
    const model = new ScriptedModel([reply(reel('The whole thing', [['w0', 'w62']], ['w0', 'w6'], { seconds: 5 }))]);
    const [whole] = (await ai(model).proposeReels(req())).candidates;
    expect(whole.seconds).toBeCloseTo(63 * 0.4 + 62 * 0.25, 3); // 40.7
  });

  // fails if a reel too short to stand alone, or too long for a reel, reaches the card
  it('refuses a reel under 15 s and one over 90 s', () => {
    expect(problems({ candidates: [reel('Fold later', [['w0', 'w19']])] })).toMatch(/r1: plays for 12\.8 s; a reel plays for 15 to 90 s/);
    const slow = req({ transcript: fixture(1.75) });
    expect(problems({ candidates: [reel('The whole thing', [['w0', 'w62']])] }, slow)).toMatch(/r1: plays for 125\.8 s; a reel plays for 15 to 90 s/);
  });

  // fails if a proposal may reuse words this reel or an earlier pick already plays
  it('refuses a reel inside TAKEN', () => {
    const taken = req({ taken: [{ from: 'w36', to: 'w62' }] });
    expect(problems({ candidates: [reel('Why I stopped using a mixer', [MIXER])] }, taken)).toMatch(/r1: keep\[0\] \(w36\.\.w62\) uses w36, which TAKEN already has \(w36\.\.w62\)/);
  });

  // fails if a reel's hook may be words it never opens on
  it('refuses a hook that is not the start of keep[0]', () => {
    expect(problems({ candidates: [reel('The one fold that fixed my crumb', [CRUMB], ['w7', 'w11'])] })).toMatch(/r1: hook must start on keep\[0\]'s first word \(w0\)/);
  });

  // fails if a proposal is attempted with no editor, or a third paid call follows two unusable replies
  it('needs an editor, and gives up after two unusable replies with what was wrong', async () => {
    await expect(ai().proposeReels(req())).rejects.toMatchObject({ code: 'no_ai' });
    const model = new ScriptedModel([
      { text: 'Here are some reels you could make.' },
      reply(reel('Sourdough notes', [CRUMB])),
    ]);
    const failed = await ai(model).proposeReels(req()).catch((e) => e);
    expect(failed).toMatchObject({ code: 'propose_failed', userMessage: "I couldn't find the reels in this video this time." });
    expect(failed.message).toMatch(/r1: title is the video's own title/);
    expect(model.requests).toHaveLength(2);
  });
});

describe('a reel made from a proposal', () => {
  const finish = { toolCalls: [call('finish', { summary_for_user: 'Done.' })] };
  async function proposed() {
    const { root, dir } = await makeProject();
    const p = JSON.parse(await fsp.readFile(path.join(dir, 'project.json'), 'utf8'));
    p.cut.keep = [{ from: 'w27', to: 'w56' }];
    p.proposal = { candidate: 'r2', title: 'The flour that made a brick', hook: 'I spent twenty bucks on a fancy flour', why: 'I kept the mistake and the fix together.', from: 'baking-bread' };
    await fsp.writeFile(path.join(dir, 'project.json'), JSON.stringify(p));
    return { dir, host: new FakeHost(root) };
  }

  // fails if its first edit is not told what the reel is, or plays a first look of the whole video
  it('tells the editor what it is about, and shows no first look of the whole video', async () => {
    const { dir, host } = await proposed();
    const model = new ScriptedModel([finish]);
    await createAI({ host, settingsDir: tmpDir(), providerOverride: model, finalRender: false }).firstEdit(dir, () => undefined);
    const task = JSON.stringify(model.requests[0].messages);
    expect(task).toContain('It is about: The flour that made a brick.');
    expect(task).toContain('It opens on: \\"I spent twenty bucks on a fancy flour\\".');
    expect(host.calls.filter((c) => c.args.includes('--first-look'))).toEqual([]);
  });

  // fails if the edit made without an editor replaces the proposed words with an autocut of the whole video
  it('keeps its proposed words when it is made without the editor', async () => {
    const { dir, host } = await proposed();
    await createAI({ host, settingsDir: tmpDir(), finalRender: false }).firstEdit(dir, () => undefined);
    expect(host.calls.map((c) => c.command)).not.toContain('autocut');
    expect((await loadProject(dir)).cut.keep).toEqual([{ from: 'w27', to: 'w56' }]);
  });
});
