import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpDir } from './helpers';

/** What a stand-in CLI does when it runs. */
export interface FakeCliRun {
  /** a file that gets this run's arguments, joined by spaces, as one line */
  argsLog?: string;
  /** printed once stdin closes */
  stdout?: string;
  /** run this long without reading stdin or answering (until killed) */
  sleepSeconds?: number;
}

/**
 * A stand-in for a CLI the app spawns by path, named `name`, in a new folder. macOS and Linux get a shell script.
 * Windows spawns only a real .exe without a shell, so there it is fake-cli.cs, built once with the C# compiler every
 * Windows 10 and 11 has (.NET Framework 4), plus a <name>.txt beside it that says what to do.
 */
export function fakeCli(name: string, o: FakeCliRun): string {
  const dir = tmpDir();
  if (process.platform !== 'win32') {
    if (o.stdout?.includes("'")) throw new Error(`fakeCli: a single quote can't go in the shell script's echo: ${o.stdout}`);
    const lines = ['#!/bin/sh'];
    if (o.argsLog) lines.push(`echo "$*" >> '${o.argsLog}'`);
    if (o.sleepSeconds) lines.push(`exec sleep ${o.sleepSeconds}`);
    else lines.push('cat >/dev/null', ...(o.stdout ? [`echo '${o.stdout}'`] : []));
    const bin = path.join(dir, name);
    fs.writeFileSync(bin, lines.join('\n') + '\n', { mode: 0o755 });
    return bin;
  }
  const bin = path.join(dir, `${name}.exe`);
  fs.copyFileSync(windowsFakeCli(), bin);
  fs.writeFileSync(path.join(dir, `${name}.txt`), `${o.argsLog ?? ''}\n${o.sleepSeconds ?? 0}\n${o.stdout ?? ''}`);
  return bin;
}

let built: string | undefined;
function windowsFakeCli(): string {
  if (built) return built;
  const src = path.join(__dirname, 'fake-cli.cs');
  const hash = createHash('sha256').update(fs.readFileSync(src)).digest('hex').slice(0, 12);
  const dir = path.join(os.tmpdir(), `rs-fake-cli-${hash}`);
  const exe = path.join(dir, 'fake-cli.exe');
  if (!fs.existsSync(exe)) {
    const csc = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    if (!fs.existsSync(csc)) throw new Error(`fakeCli needs the .NET Framework 4 C# compiler, which is not at ${csc}`);
    fs.mkdirSync(dir, { recursive: true });
    // test workers build at the same time: each writes its own file, and the first rename wins
    const mine = path.join(dir, `fake-cli-${process.pid}.exe`);
    execFileSync(csc, ['/nologo', '/optimize', '/target:exe', `/out:${mine}`, src], { stdio: 'pipe' });
    try { fs.renameSync(mine, exe); } catch { if (!fs.existsSync(exe)) throw new Error(`fakeCli could not place ${exe}`); fs.rmSync(mine, { force: true }); }
  }
  return (built = exe);
}
