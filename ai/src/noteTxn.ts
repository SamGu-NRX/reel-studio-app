// A note is all-or-nothing. Its tools change project.json, work/assets, versions/ and My style one call
// at a time, so before the first change begin() copies project.json (and work/assets/credits.json)
// into work/.note-in-progress/ beside a marker. The tools then record in the marker each thing they
// create (ToolJournal), as they create it. commit() deletes the marker; rollback() puts the copies
// back and removes exactly what the marker records, never anything inferred from a folder listing.
// A marker still on disk later means the process died mid-note (a crash or a force quit skips every
// catch), and recoverNote() does the same rollback before anything else edits the project.
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { PROJECT_FILE, readJson, writeFileAtomic } from './project';
import { StyleStore } from './style';
import type { ToolJournal } from './tools';

const DIR = path.join('work', '.note-in-progress');
const MARKER = 'note.json';
const CREDITS = path.join('work', 'assets', 'credits.json');
const PREVIEW = path.join('versions', 'preview');

interface Marker {
  v: 2;
  /** the app's id for this note; the committed note record carries it too (NoteEntry.txnId) */
  txnId: string;
  /** project.json `id` and the sha256 of the copy: recovery refuses a marker that belongs to another project or copy */
  projectId: string;
  sha256: string;
  startedAt: string;
  /** project-relative files and folders the note created (downloads, animations, its version folder) */
  created: string[];
  /** My style rule ids the note created, recorded before each save */
  styleRules: string[];
  /** work/assets/credits.json before the note: a copy beside the marker, or none */
  credits: 'saved' | 'absent';
  /** versions/preview before the note's first preview: moved beside the marker, none, or not yet touched */
  preview: 'untouched' | 'saved' | 'absent';
}

export type RecoverResult = 'undone' | 'refused' | 'none';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const at = (projectDir: string, ...p: string[]) => path.join(projectDir, ...p);

export class NoteTransaction {
  private saving: Promise<void> = Promise.resolve();

  private constructor(private readonly projectDir: string, private readonly marker: Marker, private readonly store: StyleStore) {}

  get txnId(): string { return this.marker.txnId; }

  /** Call before the note's first change, after recoverNote (a marker left by a dead note is never overwritten). */
  static async begin(projectDir: string, store: StyleStore, txnId: string): Promise<NoteTransaction> {
    const dir = at(projectDir, DIR);
    if (fs.existsSync(at(dir, MARKER))) throw new Error(`${dir} holds a note that did not finish: run recoverNote first`);
    const bytes = await fsp.readFile(at(projectDir, PROJECT_FILE));
    const projectId = JSON.parse(bytes.toString('utf8'))?.id;
    if (typeof projectId !== 'string' || !projectId) throw new Error(`${projectDir}/project.json has no id`);
    // the copies first: a marker on disk always has its copies beside it
    await writeFileAtomic(at(dir, PROJECT_FILE), bytes);
    const credits = await fsp.readFile(at(projectDir, CREDITS)).catch(() => null);
    if (credits) await writeFileAtomic(at(dir, 'credits.json'), credits);
    const marker: Marker = {
      v: 2, txnId, projectId, sha256: sha256(bytes), startedAt: new Date().toISOString(),
      created: [], styleRules: [], credits: credits ? 'saved' : 'absent', preview: 'untouched',
    };
    await writeFileAtomic(at(dir, MARKER), JSON.stringify(marker));
    return new NoteTransaction(projectDir, marker, store);
  }

  /** Marker writes in call order: parallel tools journal at once, and a later write must hold every earlier entry. */
  private save(): Promise<void> {
    this.saving = this.saving.then(() => writeFileAtomic(at(this.projectDir, DIR, MARKER), JSON.stringify(this.marker)));
    return this.saving;
  }

  /** What the note's tools record as they write (ToolContext.journal). */
  readonly journal: ToolJournal = {
    created: async (ref: string) => {
      const rel = path.relative(this.projectDir, path.resolve(this.projectDir, ref));
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`note journal: ${ref} is outside the project`);
      this.marker.created.push(rel.split(path.sep).join('/'));
      await this.save();
    },
    preview: async () => {
      if (this.marker.preview !== 'untouched') return;
      const live = at(this.projectDir, PREVIEW);
      this.marker.preview = fs.existsSync(live) ? 'saved' : 'absent';
      await this.save();
      if (this.marker.preview === 'saved') await fsp.rename(live, at(this.projectDir, DIR, 'preview'));
    },
  };

  /** My style for this note's tools: the id of each rule it saves is in the marker before the save. */
  get style(): StyleStore {
    return new Proxy(this.store, {
      get: (target, key, receiver) => key !== 'add' ? Reflect.get(target, key, receiver) : async (text: string) => {
        const id = randomUUID();
        this.marker.styleRules.push(id);
        await this.save();
        return target.add(text, id);
      },
    });
  }

  /** Put everything back as before the note, and keep the transaction open (the fast path hands the note to the AI after this). */
  async restore(): Promise<void> {
    await this.saving;
    await undo(this.projectDir, this.marker, this.store);
    this.marker.created = []; this.marker.styleRules = []; this.marker.preview = 'untouched';
    await this.save();
  }

  /** The note failed: put everything back and close. If this throws, the marker stays and the next start finishes the undo. */
  async rollback(): Promise<void> {
    await this.saving;
    await undo(this.projectDir, this.marker, this.store);
    await end(this.projectDir);
  }

  /** The note is saved with its video: from here on it is the project. */
  async commit(): Promise<void> {
    await this.saving;
    // the preview from before the note comes back only when the note made none of its own
    const saved = at(this.projectDir, DIR, 'preview');
    if (this.marker.preview === 'saved' && fs.existsSync(saved) && !fs.existsSync(at(this.projectDir, PREVIEW))) {
      await fsp.rename(saved, at(this.projectDir, PREVIEW));
    }
    await end(this.projectDir);
  }
}

async function undo(projectDir: string, m: Marker, store: StyleStore): Promise<void> {
  const dir = at(projectDir, DIR);
  await writeFileAtomic(at(projectDir, PROJECT_FILE), await fsp.readFile(at(dir, PROJECT_FILE)));
  // credits.json is written only by the note's own downloads and screenshots (engine fetch-image, register-capture)
  if (m.credits === 'saved') await writeFileAtomic(at(projectDir, CREDITS), await fsp.readFile(at(dir, 'credits.json')));
  else await fsp.rm(at(projectDir, CREDITS), { force: true });
  for (const rel of m.created) await fsp.rm(at(projectDir, rel), { recursive: true, force: true });
  const ours = new Set(m.styleRules);
  for (const rule of await store.list()) if (ours.has(rule.id)) await store.remove(rule.id);
  const saved = at(dir, 'preview');
  if (m.preview === 'absent' || (m.preview === 'saved' && fs.existsSync(saved))) await fsp.rm(at(projectDir, PREVIEW), { recursive: true, force: true });
  // 'saved' without the moved folder: the process died before the move, so the original never left
  if (m.preview === 'saved' && fs.existsSync(saved)) await fsp.rename(saved, at(projectDir, PREVIEW));
}

async function end(projectDir: string): Promise<void> {
  const dir = at(projectDir, DIR);
  await fsp.rm(at(dir, MARKER), { force: true });   // the commit point
  await fsp.rm(dir, { recursive: true, force: true });
}

/** Undoes a note the process died in the middle of. Run it while holding the project's edit lock,
 * before anything else changes the project. 'refused': the marker was not this project's own (a copied
 * project folder, or a copy that does not match its marker); it is removed and nothing is restored. */
export async function recoverNote(projectDir: string, store: StyleStore): Promise<RecoverResult> {
  const dir = at(projectDir, DIR);
  if (!fs.existsSync(at(dir, MARKER))) {
    await fsp.rm(dir, { recursive: true, force: true });   // copies whose marker was never written: the note had not started
    return 'none';
  }
  const m = await readJson<Marker>(at(dir, MARKER)).catch(() => null);
  const copy = await fsp.readFile(at(dir, PROJECT_FILE)).catch(() => null);
  const live = await readJson<{ id?: unknown }>(at(projectDir, PROJECT_FILE)).catch(() => null);
  if (m?.v !== 2 || !copy || sha256(copy) !== m.sha256 || live?.id !== m.projectId) {
    await end(projectDir);
    return 'refused';
  }
  await undo(projectDir, m, store);
  await end(projectDir);
  return 'undone';
}
