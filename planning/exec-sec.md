## Exec security plan (Option 2)

**Target** (macOS-only): `shell:false` argv exec + resolved-binary allowlist + `sandbox-exec` + file-writing tools + pipeline tool.

### Score

**9 / 10** for Greg-as-used. Greg’s logs show constant `&&`, pipes, redirects, `$()` and temp-file flows; Option 2 keeps that capability but moves it into structured primitives, removing shell-string quoting/injection as the default failure mode and making enforcement feasible.

## Non-negotiables

- **No shell parsing** in the default exec path (no `;`, `&&`, `|`, `>`, `$()`, backticks).
- **Allowlist is resolved paths** (no basename matching).
- **Every subprocess tree runs under `sandbox-exec`** (exec + pipeline segments).
- **Writes go through file tools** (workspace + `/tmp/greg/**`), not shell redirects.

## What “good” looks like (architecture)

- **Exec tool**: runs exactly one `{ bin, args[] }` (argv). Deterministic, allowlistable.
- **Pipeline tool**: runs `segments: Array<{ bin, args[] }>` with explicit stdin/stdout/stderr wiring (no shell).
  - Each segment must be resolved + allowlisted.
  - Output capture is explicit (final output and/or per-segment), with size limits.
- **File tools**: the only way to write files (including temp files). Prefer a consistent scratch root: `/tmp/greg/**`.
- **OS layer**: generate SBPL from the same path policy and wrap processes with `sandbox-exec`.

## Policy model (fits how Greg actually works)

- **Filesystem** (fail-closed):
  - allow `rw` under workspace repo(s)
  - allow `rw` under `/tmp/greg/**`
  - deny everything else
  - support **protected subtrees** (e.g. allow repo writes but deny `repo/tools/**`)
- **Binaries**:
  - allowlist by **resolved absolute path**
  - treat runtimes/interpreters (`bash`, `sh`, `node`, `python`, `bun`) as higher risk; keep them tight / approval-gated where possible

## Phased execution checklist (minimize breakage)

- **Phase 0 (inventory, no behavior change)**
  - enumerate top binaries from real usage (git, grep, awk, sed, head/tail/wc, bun/node/python, project CLIs)
  - build initial resolved-path allowlist
  - define initial FS policy: workspace + `/tmp/greg/**`
  - add `sandbox-exec` wrapper behind a flag (off)

- **Phase 1 (pipelines without shell)**
  - implement pipeline tool
  - migrate common patterns: `| head`, `| tail`, `| grep`, and “merge stderr then filter” (`2>&1 | head`)
  - make stderr handling explicit per segment (capture/merge/ignore)

- **Phase 2 (replace redirects + temp files)**
  - replace `> /tmp/x` with file-write tool under `/tmp/greg/**`
  - replace `$(cat /tmp/x)` with file-read tool + pass content/bytes explicitly to next tool

- **Phase 3 (turn on `sandbox-exec`)**
  - generate SBPL from FS policy (prefer exact and `/prefix/**` patterns)
  - wrap every exec + pipeline segment with `sandbox-exec -p <profile> …`
  - verify baseline allowances needed for common tools don’t regress (git, grep, etc.)

- **Phase 4 (escape hatches)**
  - if a raw shell command path must exist: keep it **approval-gated**, still `sandbox-exec` wrapped, and default-deny metasyntax

## Tests (must match real failure modes)

- **Bare filename**: within workspace allowed; outside denied.
- **Non-argv effects**: e.g. extraction/compilation can’t write outside allowed roots.
- **Pipeline semantics**: stdout/stderr behavior matches expected “merge then filter”.
- **Protected subtree**: repo writable but `repo/tools/**` not writable; git still works.

## TODO (implementation checklist)

- [x] Confirm macOS-only rollout; document out-of-scope platforms for now
- [ ] Decide whether a raw shell escape hatch exists; if yes, make it approval-gated and default-deny metasyntax

- [ ] Implement/solidify filesystem policy defaults: workspace `rw`, `/tmp/greg/** rw`, deny everything else
- [ ] Add protected-subtree denies (e.g. allow repo writes but deny `repo/tools/**`)

- [ ] Build resolved-binary allowlist (absolute resolved paths only; no basenames)
- [ ] Decide posture for interpreters/runtimes (`bash`, `sh`, `node`, `python`, `bun`): tight allowlist vs approval-gated

- [ ] Ensure exec runs only `{ bin, args[] }` with `shell:false` semantics (no command strings)
- [ ] Resolve `bin` and enforce allowlist before spawn
- [ ] Make stdout/stderr handling explicit (capture/merge/ignore) and enforce output limits

- [ ] Implement pipeline tool with `segments: Array<{ bin, args[] }>` and explicit wiring (no shell)
- [ ] Enforce allowlist per pipeline segment (resolved binary)
- [ ] Support “merge stderr then filter” workflows without `2>&1` syntax

- [ ] Route all file writes through file tools (remove reliance on shell redirects)
- [ ] Standardize scratch/temp under `/tmp/greg/**` (create/read/write)
- [ ] Migrate common patterns: `> /tmp/x` and `$(cat /tmp/x)` to file tools + explicit inputs

- [ ] Implement SBPL generation from FS policy (prefer exact and `/prefix/**` patterns)
- [ ] Wrap every exec/pipeline subprocess tree with `sandbox-exec -p <profile> …`
- [ ] Validate baseline allowances for common tools (git/grep/etc.) without widening FS access

- [ ] Add tests: bare filenames, non-argv effects, pipeline semantics, protected subtree enforcement
