// A note is all-or-nothing. Its tools change project.json, work/assets, versions/ and My style one call
// at a time, so before the first change begin() writes the project as it was and a marker into
// work/.note-in-progress/. commit() deletes them; rollback() puts everything back. A marker still on
// disk later means the process died mid-note (a crash or a force quit skips every catch), and
// recoverNote() does the same rollback before anything else edits the project.
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { PROJECT_FILE, readJson, writeFileAtomic } from './project';
import { StyleStore } from './style';

const DIR = path.join('work', '.note-in-progress');
const MARKER = 'note.json';

interface Marker {
  v: 1;
  startedAt: string;
  /** work/assets files before the note: anything new is the note's download */
  assets: string[];
  /** versions/vN folders before the note: a new one is the note's final render */
  versions: string[];
  /** My style rule ids before the note */
  styleRules: string[];
  /** rule texts the note saved, written BEFORE each save so a crash right after it can still undo it */
  styleTexts: string[];
}

const listDir = async (dir: string) => fsp.readdir(dir).catch(() => [] as string[]);
const versionFolders = async (projectDir: string) => (await listDir(path.join(projectDir, 'versions'))).filter((f) => /^v\d+$/.test(f));

export class NoteTransaction {
  private constructor(private readonly projectDir: string, private readonly marker: Marker, private readonly store: StyleStore) {}

  /** Call before the note's first change (after recoverNote: a marker left by a dead note is not overwritten). */
  static async begin(projectDir: string, store: StyleStore): Promise<NoteTransaction> {
    const dir = path.join(projectDir, DIR);
    if (fs.existsSync(path.join(dir, MARKER))) throw new Error(`${dir} holds a note that did not finish: run recoverNote first`);
    const marker: Marker = {
      v: 1, startedAt: new Date().toISOString(),
      assets: await listDir(path.join(projectDir, 'work', 'assets')),
      versions: await versionFolders(projectDir),
      styleRules: (await store.list()).map((r) => r.id),
      styleTexts: [],
    };
    // the copy first: a marker on disk always has its copy beside it
    await writeFileAtomic(path.join(dir, PROJECT_FILE), await fsp.readFile(path.join(projectDir, PROJECT_FILE)));
    await writeFileAtomic(path.join(dir, MARKER), JSON.stringify(marker));
    return new NoteTransaction(projectDir, marker, store);
  }

  /** My style for this note's tools: add() records the rule in the marker before saving it. */
  get style(): StyleStore {
    return new Proxy(this.store, {
      get: (target, key, receiver) => key !== 'add' ? Reflect.get(target, key, receiver) : async (text: string) => {
        this.marker.styleTexts.push(text);
        await writeFileAtomic(path.join(this.projectDir, DIR, MARKER), JSON.stringify(this.marker));
        return target.add(text);
      },
    });
  }

  /** Put everything back as before the note, and keep the transaction open (the fast path hands the note to the AI after this). */
  async restore(): Promise<void> {
    await undo(this.projectDir, this.marker, this.store);
  }

  /** The note failed: put everything back and close. If this throws, the marker stays and the next start finishes the undo. */
  async rollback(): Promise<void> {
    await undo(this.projectDir, this.marker, this.store);
    await end(this.projectDir);
  }

  /** The note is saved with its video: from here on it is the project. */
  async commit(): Promise<void> {
    await end(this.projectDir);
  }
}

async function undo(projectDir: string, m: Marker, store: StyleStore): Promise<void> {
  const dir = path.join(projectDir, DIR);
  await writeFileAtomic(path.join(projectDir, PROJECT_FILE), await fsp.readFile(path.join(dir, PROJECT_FILE)));
  const keptRules = new Set(m.styleRules);
  for (const text of m.styleTexts) {
    const rule = await store.find(text);
    if (rule && !keptRules.has(rule.id)) await store.remove(rule.id);
  }
  const keptAssets = new Set(m.assets);
  for (const f of await listDir(path.join(projectDir, 'work', 'assets'))) {
    // attach-* files are the user's, imported by the app (possibly for the note being sent now), never a tool's download
    if (!keptAssets.has(f) && !f.startsWith('attach-')) await fsp.rm(path.join(projectDir, 'work', 'assets', f), { recursive: true, force: true });
  }
  // a version folder the note's final render made would show a video of an edit that is no longer the project
  const keptVersions = new Set(m.versions);
  for (const v of await versionFolders(projectDir)) {
    if (!keptVersions.has(v)) await fsp.rm(path.join(projectDir, 'versions', v), { recursive: true, force: true });
  }
}

async function end(projectDir: string): Promise<void> {
  const dir = path.join(projectDir, DIR);
  await fsp.rm(path.join(dir, MARKER), { force: true });   // the commit point
  await fsp.rm(dir, { recursive: true, force: true });
}

/** Undoes a note the process died in the middle of. Returns true when there was one. Run it while
 * holding the project's edit lock, before anything else changes the project. */
export async function recoverNote(projectDir: string, store: StyleStore): Promise<boolean> {
  const dir = path.join(projectDir, DIR);
  if (!fs.existsSync(path.join(dir, MARKER))) {
    await fsp.rm(dir, { recursive: true, force: true });   // a copy whose marker was never written: the note had not started
    return false;
  }
  const m = await readJson<Marker>(path.join(dir, MARKER));
  if (m?.v !== 1) throw new Error(`unknown note marker version in ${dir}`);
  await undo(projectDir, m, store);
  await end(projectDir);
  return true;
}
