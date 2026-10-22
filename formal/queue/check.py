#!/usr/bin/env python3
"""Run TLC and reject missing or unexpected counterexamples."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[1] / '.tools'
JAVA = TOOLS / 'jdk-21.0.12.1+1-jre/Contents/Home/bin/java'
JAR = TOOLS / 'tla2tools.jar'
CASES = {
    'safety': ('Queue.cfg', None),
    'liveness': ('Queue-live.cfg', None),
    'permit': ('Queue-permit.cfg', 'Invariant OneRender is violated'),
    'remove': ('Queue-remove.cfg', 'Invariant NoAdmittedLost is violated'),
    'admission': ('Queue-admission.cfg', 'Invariant AdmissionBeforeAck is violated'),
    'admission-loss': ('Queue-admission-loss.cfg', 'Invariant NoAdmittedLost is violated'),
    'replay': ('Queue-replay.cfg', 'Invariant NoDoubleCommit is violated'),
    'restart': ('Queue-restart.cfg', 'Invariant OneRender is violated'),
    'hold': ('Queue-hold.cfg', 'Invariant HoldUntilResume is violated'),
    'starvation': ('Queue-starvation.cfg', 'Temporal properties were violated'),
}
selected = sys.argv[1:] or list(CASES)
unknown = set(selected) - CASES.keys()
if unknown:
    sys.exit(f'Unknown check: {sorted(unknown)}')
if not JAVA.is_file() or not JAR.is_file():
    sys.exit('Java or TLC is missing from .tools. See README.md.')
expected_sha = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88'
if hashlib.sha256(JAR.read_bytes()).hexdigest() != expected_sha:
    sys.exit('TLC jar checksum differs from the checked v1.7.4 release.')
evidence = HERE / 'evidence'
evidence.mkdir(exist_ok=True)
for name in selected:
    config, error = CASES[name]
    args = [str(JAVA), '-Xmx768m', '-XX:+UseParallelGC', '-cp', str(JAR),
            'tlc2.TLC', '-workers', '1', '-fp', '0', '-seed', '1',
            '-lncheck', 'final', '-metadir', str(TOOLS / f'check-{name}'),
            '-config', config, 'Queue.tla']
    result = subprocess.run(args, cwd=HERE, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True)
    output = result.stdout.replace(str(HERE.parents[1]), '<worktree>')
    output = re.sub(r'/private/var/folders/[^\s]+/', '<java-tmp>/', output)
    (evidence / f'{name}.txt').write_text(output)
    expected_code = 13 if name == 'starvation' else 12 if error else 0
    marker = error or 'Model checking completed. No error has been found.'
    if result.returncode != expected_code or marker not in output:
        sys.exit(f'{name}: unexpected result {result.returncode}; inspect evidence/{name}.txt')
    counts = re.findall(r'(\d+) states generated, (\d+) distinct states found', output)
    if not counts:
        sys.exit(f'{name}: TLC did not report final state counts')
    record = {'check': name, 'config': config, 'exit': result.returncode,
              'generated': int(counts[-1][0]), 'distinct': int(counts[-1][1]),
              'expected': marker,
              'model_sha256': hashlib.sha256((HERE / 'Queue.tla').read_bytes()).hexdigest()}
    (evidence / f'{name}.json').write_text(json.dumps(record, indent=2) + '\n')
    print(f'{name}: expected result, {record["distinct"]:,} distinct states', flush=True)
