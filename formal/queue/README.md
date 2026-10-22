# Check the queue protocol

This is bounded evidence for Foundation 2 of the queue design. It does not patch the app or prove that its TypeScript implements the protocol. Read [the methods and findings](methods.md) before treating a passing check as implementation evidence.

The inspected sources are `notes-queue-proto` at `175956bf4b32979a6a0c0c88e6bd2b413ec08f10` and `fork/note-atomic` at `059e485da184e29ca34354a0db5825dccf0d1d28`. This evidence branch starts from `7d9e277`, so the prototype code is not part of its diff.

## Run the checks

Install a Java runtime and the [TLC v1.7.4 release](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4) inside the repository's gitignored `.tools` directory. The recorded run used TLC 2.19 and Temurin JRE 21.0.12.1+1 on macOS ARM64. The [TLC command reference](https://docs.tlapl.us/using:tlc:start) describes the checker options.

From the repository root, download the pinned tools:

```sh
mkdir -p .tools
curl -fL -o .tools/tla2tools.jar https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
curl -fL -o .tools/jre.tar.gz 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.12.1_1.tar.gz'
```

Verify the downloads before extracting Java:

```sh
printf '%s\n' '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88  .tools/tla2tools.jar' 'dec50fc6f9fcd4fe3ae8cabf5a5fa68f6afc48841f7698e468e9aa5d54beed84  .tools/jre.tar.gz' | shasum -a 256 -c -
tar -xzf .tools/jre.tar.gz -C .tools
python3 formal/queue/check.py
```

Both checksum checks must pass. The runner expects that Java path; use the corresponding Adoptium archive and change `JAVA` in `check.py` on another platform. Java and TLC are research tools, not app dependencies.

`check.py` uses one worker and a 768 MB heap. It runs each check to completion, writes a log and a JSON result under `evidence`, and fails if the exit code or expected counterexample differs. Run selected checks by name, for example `python3 formal/queue/check.py permit remove admission`. A mutation's expected failure counts as a successful check of the detector.

The safety configuration uses three stable note IDs, two projects, and two payload values. The liveness configuration uses the same IDs and projects but one payload value. Payload never controls scheduling, so collapsing it removes edit-only cycles without removing a scheduling behavior. Crashes are unbounded in safety. The temporal claim assumes an eventual crash-free suffix.

## Read the evidence

- `Queue.cfg` checks safety and the absence of a state with unfinished work but no progress action.
- `Queue-live.cfg` checks eventual commit, failure, or cancellation, with the fairness assumptions stated in `methods.md`.
- The `permit`, `remove`, and `admission` configurations inject the requested defects. `admission-loss` follows the missing persistence through a crash.
- The `replay`, `restart`, and `hold` configurations exercise committed-note replay, surviving render groups, and premature release of a queue hold.
- `Queue-starvation.cfg` preserves a fair counterexample when a failed head is retried forever. It deliberately omits the eventual cancellation assumption.

The logs retain TLC's state counts and counterexamples. JSON files bind each result to the model's SHA-256. Local absolute paths are redacted. No finite bound establishes correctness for every queue length, filesystem, or operating system.
