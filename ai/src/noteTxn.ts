// A note is all-or-nothing. Its tools change project.json, work/assets, versions/ and My style one call
// at a time, so before the first change begin() copies project.json (and work/assets/credits.json)
// into work/.note-in-progress/ beside a marker. The tools then record in the marker each thing they
// create or modify (ToolJournal), as they do it. Deleting the marker commits the note; rollback() puts
// the copies back and removes exactly what the marker records, never anything inferred from a folder
// listing. A marker still on disk later means the process died mid-note (a crash or a force quit skips
// every catch), and recoverNote() does the same rollback before anything else edits the project.
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

/** What a note may create: one file in work/assets or work/thumbs, a version folder, or one file in a
 * version folder. Recovery deletes these, so a marker naming anything else (a folder like "work",
 * "../x", project.json) is refused whole. */
const CREATABLE = /^(work\/assets\/[^/]+|work\/thumbs\/[^/]+|versions\/v\d+(\/[^/]+)?)$/;
/** What a note may modify and put back from a copy: a file in a version folder it re-used (notes.md). */
const MODIFIABLE = /^versions\/v\d+\/[^/]+$/;

interface Modified { path: string; copy: string }

interface Marker {
  v: 3;
  /** the app's id for this note; the committed note record carries it too (NoteEntry.txnId) */
  txnId: string;
  /** project.json `id`, the project folder's real path and the sha256 of the copy: recovery refuses a
   * marker that belongs to another project, another folder (a copied project) or another copy */
  projectId: string;
  folder: string;
  sha256: string;
  startedAt: string;
  /** project-relative files and folders the note created (downloads, animations, its version folder) */
  created: string[];
  /** existing files the note changed, each with its copy (a file name in the marker's folder) */
  modified: Modified[];
  /** My style rule ids the note created, recorded before each save */
  styleRules: string[];
  /** work/assets/credits.json before the note: a copy beside the marker, or none */
  credits: 'saved' | 'absent';
  /** versions/preview before the note's first preview: moved beside the marker, none, or not yet touched */
  preview: 'untouched' | 'saved' | 'absent';
}

/** 'refused': the marker was proven not this project's own and was removed. 'blocked': it could not be
 * undone now (a path that leads out of the project, or a read or write that failed); marker and copies
 * are kept, and the project must not be edited until a later attempt undoes it. */
export type RecoverResult = 'undone' | 'refused' | 'blocked' | 'none';

/** A path the note would write or delete leads out of the project folder (a symlink on the way). */
export class UnsafePathError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsafePathError'; }
}
type Log = (line: string) => void;

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const at = (projectDir: string, ...p: string[]) => path.join(projectDir, ...p);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isStrList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const COPY_NAME = /^modified-\d+$/;
/** POSIX normal form, and no backslash: Windows reads "work/assets/..\\..\\x" as a path out of the project. */
const plain = (p: string) => !p.includes('\\') && path.posix.normalize(p) === p;

/** Why a marker read from disk cannot be trusted, or null when it is well formed. */
function markerProblem(m: any): string | null {
  if (!m || typeof m !== 'object' || m.v !== 3) return 'unknown marker version';
  for (const k of ['txnId', 'projectId', 'folder', 'sha256', 'startedAt']) if (!isStr(m[k])) return `${k} is missing`;
  if (!isStrList(m.created) || !isStrList(m.styleRules) || !Array.isArray(m.modified)) return 'a list is malformed';
  if (m.credits !== 'saved' && m.credits !== 'absent') return 'credits is malformed';
  if (!['untouched', 'saved', 'absent'].includes(m.preview)) return 'preview is malformed';
  const bad = m.created.find((p: string) => !CREATABLE.test(p) || !plain(p));
  if (bad !== undefined) return `created entry ${JSON.stringify(bad)} is not a file the note could make`;
  for (const e of m.modified) {
    if (!e || !isStr(e.path) || !MODIFIABLE.test(e.path) || !plain(e.path) || !isStr(e.copy) || !COPY_NAME.test(e.copy)) {
      return `modified entry ${JSON.stringify(e)} is malformed`;
    }
  }
  return null;
}

/** A project-relative path in the form the marker keeps, or an error for one outside `allowed`. */
function relPath(projectDir: string, ref: string, allowed: RegExp): string {
  const rel = path.relative(projectDir, path.resolve(projectDir, ref)).split(path.sep).join('/');
  if (!allowed.test(rel) || !plain(rel)) throw new Error(`note journal: ${ref} is not a file a note may change`);
  return rel;
}

export class NoteTransaction {
  private saving: Promise<void> = Promise.resolve();
  private committed = false;

  private constructor(private readonly projectDir: string, private readonly marker: Marker, private readonly store: StyleStore, private readonly log: Log) {}

  get txnId(): string { return this.marker.txnId; }

  /** Call before the note's first change, after recoverNote (a marker left by a dead note is never overwritten). */
  static async begin(projectDir: string, store: StyleStore, txnId: string, log: Log = () => undefined): Promise<NoteTransaction> {
    const dir = at(projectDir, DIR);
    if (fs.existsSync(at(dir, MARKER))) throw new Error(`${dir} holds a note that did not finish: run recoverNote first`);
    const bytes = await fsp.readFile(at(projectDir, PROJECT_FILE));
    const project = JSON.parse(bytes.toString('utf8'));
    const projectId = project?.id;
    if (!isStr(projectId)) throw new Error(`${projectDir}/project.json has no id`);
    // before the first write: every place this note can write or delete must stay inside the project
    const version = Number.isInteger(project.version) && project.version >= 0 ? project.version : 0;
    await checkPlaces(projectDir, [...FIXED_PLACES, `versions/v${version}/project.json`, `versions/v${version}/notes.md`, `versions/v${version + 1}`]);
    // the copies first: a marker on disk always has its copies beside it
    await writeFileAtomic(at(dir, PROJECT_FILE), bytes);
    const credits = await fsp.readFile(at(projectDir, CREDITS)).catch(() => null);
    if (credits) await writeFileAtomic(at(dir, 'credits.json'), credits);
    const marker: Marker = {
      v: 3, txnId, projectId, folder: await fsp.realpath(projectDir), sha256: sha256(bytes), startedAt: new Date().toISOString(),
      created: [], modified: [], styleRules: [], credits: credits ? 'saved' : 'absent', preview: 'untouched',
    };
    await writeFileAtomic(at(dir, MARKER), JSON.stringify(marker));
    return new NoteTransaction(projectDir, marker, store, log);
  }

  /** Marker writes in call order: parallel tools journal at once, and a later write must hold every earlier entry. */
  private save(): Promise<void> {
    this.saving = this.saving.then(() => writeFileAtomic(at(this.projectDir, DIR, MARKER), JSON.stringify(this.marker)));
    return this.saving;
  }

  /** What the note's tools record as they write (ToolContext.journal). */
  readonly journal: ToolJournal = {
    created: async (ref: string) => {
      const rel = relPath(this.projectDir, ref, CREATABLE);
      await checkPlaces(this.projectDir, [rel]);
      this.marker.created.push(rel);
      await this.save();
    },
    modified: async (ref: string) => {
      const rel = relPath(this.projectDir, ref, MODIFIABLE);
      await checkPlaces(this.projectDir, [rel]);
      const m = this.marker;
      if (m.created.some((c) => rel === c || rel.startsWith(`${c}/`)) || m.modified.some((e) => e.path === rel)) return;
      const bytes = await fsp.readFile(at(this.projectDir, rel)).catch(() => null);
      if (!bytes) { m.created.push(rel); await this.save(); return; }
      const copy = `modified-${m.modified.length}`;
      await writeFileAtomic(at(this.projectDir, DIR, copy), bytes);
      m.modified.push({ path: rel, copy });
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
    Object.assign(this.marker, { created: [], modified: [], styleRules: [], preview: 'untouched' });
    await this.save();
  }

  /** The note failed: put everything back and close. A no-op once committed. If this throws, the marker
   * stays and the next start finishes the undo. */
  async rollback(): Promise<void> {
    if (this.committed) return;
    await this.saving;
    await undo(this.projectDir, this.marker, this.store);
    await fsp.rm(at(this.projectDir, DIR, MARKER), { force: true });
    await this.cleanUp();
  }

  /** The note is saved with its video. Throws only before the commit point (the marker's deletion);
   * after it the note stands, and cleanup failures are only logged. */
  async commit(): Promise<void> {
    await this.saving;
    // the preview from before the note comes back only when the note made none of its own
    const saved = at(this.projectDir, DIR, 'preview');
    if (this.marker.preview === 'saved' && fs.existsSync(saved) && !fs.existsSync(at(this.projectDir, PREVIEW))) {
      await fsp.rename(saved, at(this.projectDir, PREVIEW));
    }
    await fsp.rm(at(this.projectDir, DIR, MARKER), { force: true });
    this.committed = true;
    await this.cleanUp();
  }

  private async cleanUp(): Promise<void> {
    await fsp.rm(at(this.projectDir, DIR), { recursive: true, force: true })
      .catch((e) => this.log(`note ${this.marker.txnId}: could not remove ${DIR} (${e?.message ?? e})`));
  }
}

/** Places every note writes or deletes whatever its tools do: the copies and marker, project.json,
 * credits.json, the preview folder and work/thumbs (thumbnails). */
const FIXED_PLACES = [`${DIR.split(path.sep).join('/')}/${MARKER}`, PROJECT_FILE, 'work/assets/credits.json', 'work/thumbs', 'versions/preview'];

/** Throws UnsafePathError when writing or deleting one of `rels` could reach outside the project. The
 * text of a path is not enough: a symlinked versions/v1 makes "versions/v1/keep.txt" a file somewhere
 * else. Each segment from the project root down must not be a symlink, and the parent's real path must
 * be inside the project's. */
async function checkPlaces(projectDir: string, rels: string[]): Promise<void> {
  const root = await fsp.realpath(projectDir);
  for (const rel of rels) {
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const st = await fsp.lstat(at(projectDir, ...parts.slice(0, i))).catch(() => null);
      if (!st) break;                                   // nothing there, so nothing below it to write through
      if (st.isSymbolicLink()) throw new UnsafePathError(`${parts.slice(0, i).join('/')} is a symlink`);
    }
    const parent = await fsp.realpath(path.dirname(at(projectDir, rel))).catch(() => null);
    if (parent && parent !== root && !parent.startsWith(root + path.sep)) throw new UnsafePathError(`${rel} is outside the project`);
  }
}

async function undo(projectDir: string, m: Marker, store: StyleStore): Promise<void> {
  // checked again: a link made after the note began, or a marker edited on disk
  await checkPlaces(projectDir, [...FIXED_PLACES, ...m.created, ...m.modified.map((e) => e.path)]);
  const dir = at(projectDir, DIR);
  await writeFileAtomic(at(projectDir, PROJECT_FILE), await fsp.readFile(at(dir, PROJECT_FILE)));
  // credits.json is written only by the note's own downloads and screenshots (engine fetch-image, register-capture)
  if (m.credits === 'saved') await writeFileAtomic(at(projectDir, CREDITS), await fsp.readFile(at(dir, 'credits.json')));
  else await fsp.rm(at(projectDir, CREDITS), { force: true });
  for (const e of m.modified) await writeFileAtomic(at(projectDir, e.path), await fsp.readFile(at(dir, e.copy)));
  for (const rel of m.created) await fsp.rm(at(projectDir, rel), { recursive: true, force: true });
  const ours = new Set(m.styleRules);
  for (const rule of await store.list()) if (ours.has(rule.id)) await store.remove(rule.id);
  const saved = at(dir, 'preview');
  if (m.preview === 'absent' || (m.preview === 'saved' && fs.existsSync(saved))) await fsp.rm(at(projectDir, PREVIEW), { recursive: true, force: true });
  // 'saved' without the moved folder: the process died before the move, so the original never left
  if (m.preview === 'saved' && fs.existsSync(saved)) await fsp.rename(saved, at(projectDir, PREVIEW));
}

/** Undoes a note the process died in the middle of. Run it while holding the project's edit lock,
 * before anything else changes the project. 'refused': the marker was malformed or not this project's
 * own (another project, a copied project folder, or a copy that does not match); it is removed, nothing
 * is restored, and the reason is logged. 'blocked': it could not be undone now; the marker and copies
 * are kept and the reason is logged. */
export async function recoverNote(projectDir: string, store: StyleStore, log: Log = () => undefined): Promise<RecoverResult> {
  const dir = at(projectDir, DIR);
  if (!fs.existsSync(at(dir, MARKER))) {
    await fsp.rm(dir, { recursive: true, force: true });   // copies whose marker was never written: the note had not started
    return 'none';
  }
  const keep = (why: string): RecoverResult => {
    log(`unfinished note in ${projectDir} not undone: ${why}. The marker and its copies were kept.`);
    return 'blocked';
  };
  const refuse = async (why: string): Promise<RecoverResult> => {
    log(`unfinished note in ${projectDir} not undone: ${why}. The marker was removed and nothing was restored.`);
    await fsp.rm(dir, { recursive: true, force: true });
    return 'refused';
  };
  // A read that fails proves nothing about whose marker this is: keep everything and try again later.
  // Only a marker that reads as malformed, or names another project, folder or copy, is removed.
  let raw: string; let copy: Buffer | null; let live: string; let folder: string;
  try {
    raw = await fsp.readFile(at(dir, MARKER), 'utf8');
    // begin() writes the copy before the marker, so a marker without one was never this project's own note
    copy = await fsp.readFile(at(dir, PROJECT_FILE)).catch((e) => { if (e?.code === 'ENOENT') return null; throw e; });
    live = await fsp.readFile(at(projectDir, PROJECT_FILE), 'utf8');
    folder = await fsp.realpath(projectDir);
  } catch (e: any) {
    return keep(`could not read it (${e?.code ?? e?.message ?? e})`);
  }
  let m: Marker;
  try { m = JSON.parse(raw); } catch { return refuse('the marker is not valid JSON'); }
  let liveId: unknown;
  try { liveId = JSON.parse(live)?.id; } catch { return keep('project.json is not valid JSON'); }
  const problem = markerProblem(m)
    ?? (!copy || sha256(copy) !== m.sha256 ? 'the project copy does not match the marker'
      : liveId !== m.projectId ? 'the marker belongs to another project'
        : folder !== m.folder ? `the marker was written in another folder (${m.folder})` : null);
  if (problem) return refuse(problem);
  try { await undo(projectDir, m, store); } catch (e: any) {
    // a path check fails before undo touches anything; any other failure leaves undo half done, and
    // undo is safe to repeat from the same copies
    return keep(e instanceof UnsafePathError ? e.message : `undo failed (${e?.code ?? e?.message ?? e})`);
  }
  await fsp.rm(at(dir, MARKER), { force: true });
  await fsp.rm(dir, { recursive: true, force: true }).catch((e) => log(`could not remove ${dir} (${e?.message ?? e})`));
  return 'undone';
}
