## Exec security plan (Option 2)

**Target** (macOS-only): `shell:false` argv exec + resolved-binary allowlist + `sandbox-exec` + file-writing tools + pipeline tool.

### Score

**9.6 / 10** for Greg-as-used (once implemented). Matches OpenClaw’s shape (structured exec + OS sandbox + file tools) with a **declarative** argv-profile layer; remaining delta is SBPL/tool-layer parity in practice.

## Non-negotiables

- **No shell parsing** in the default exec path (no `;`, `&&`, `|`, `>`, `$()`, backticks).
- **Allowlist is resolved paths** (no basename matching).
- **Every subprocess tree runs under `sandbox-exec`** (exec + pipeline segments).
- **Writes go through file tools** (workspace + `/tmp/greg/**`), not shell redirects.

## Modes (OpenClaw-style)

- **Default mode (silent)**: run only if it passes allowlisted bin + argv profile + FS policy + sandbox. Otherwise deny.
- **Ask mode (interactive)**: if denied and `tools.guard.ask:true`, ask for `/once`. If approved, run once (still sandboxed).

## What “good” looks like (architecture)

- **Exec tool**: runs exactly one `{ bin, args[] }` (argv). Deterministic, allowlistable.
- **Pipeline tool**: runs `segments: Array<{ bin, args[] }>` with explicit stdin/stdout/stderr wiring (no shell).
  - Each segment must be resolved + allowlisted.
  - Output capture is explicit (final output and/or per-segment), with size limits.
- **File tools**: the only way to write files (including temp files). Prefer a consistent scratch root: `/tmp/greg/**`.
- **OS layer**: generate SBPL from the same path policy and wrap processes with `sandbox-exec`.

## Implementation order (LLM checklist)

0. **Decide escape hatch**
   - Prefer none. If needed, make it **approval-gated**, **default-deny metasyntax**, and still run under **`sandbox-exec`** + FS policy.
1. **Config + types**
   - Add `tools.guard.exec.allowResolvedBins` + `tools.guard.exec.profiles`.
   - Validate config at startup (unknown profile name, missing profile, invalid flag spec → fail closed).
   - Define FS policy defaults: workspace `rw` + `/tmp/greg/** rw` + protected subtrees (most-specific-wins).
2. **Policy evaluation (single place)**
   - Implement in `agent/tools/exec/policy.ts` and make it the one source of truth for both `execve` and `execve_pipeline`.
3. **Validation order (exec + each pipeline step)**
   - Resolve `command` → absolute path.
   - Check resolved path exists in `allowResolvedBins` (else deny).
   - Load profile → parse/validate argv (`allowFlags` strict default-deny + `allowSubcommands`).
   - Enforce FS policy for `cwd` + any `value.type:"path"` values (workspace + `/tmp/greg/**` + protected subtrees).
4. **Execution hardening**
   - Wrap subprocess tree in `sandbox-exec` using SBPL generated from the same FS policy.
   - Apply env hardening defaults (PATH override/ignore, strip `DYLD_*`, validate/default `cwd`).
5. **Ask mode**
   - If denied and `tools.guard.ask:true`, prompt for `/once` and allow exactly once; still run through step 4.
6. **Capability migration (reduce shell-like patterns)**
   - Replace redirect/temp-file patterns with file tools; standardize scratch under `/tmp/greg/**`.
   - Ensure pipelines cover common filters (stderr merge modes + output caps) without shell metasyntax.
7. **Flip gates**
   - Enable `sandbox-exec` by default only after the acceptance tests pass under sandbox.

## OpenClaw-style “per-binary argv profiles” (Greg translation)

Enforce in `agent/tools/exec/policy.ts`, keyed by **resolved binary path**. For `execve_pipeline`, apply profiles **per step**.

Profile schema (generic, no hardcoded validators):

- **`allowSubcommands`**: `"all"` or list of token-path arrays (e.g. `["remote","add"]`).
- **`allowFlags`**: flag allowlist; _only_ listed flags are allowed (with optional value constraints). No `denyFlags` support (default-deny).

### Suggested config shape (conceptual)

Replace string-glob “allowed commands” with:

- `allowResolvedBins[resolvedPath] -> profileName`
- `profiles[profileName] -> { allowSubcommands, allowFlags }`

Example:

```json
{
  "tools": {
    "guard": {
      "enabled": true,
      "ask": true,
      "exec": {
        "allowResolvedBins": {
          "/usr/bin/git": { "profile": "git_readonly" },
          "/usr/bin/head": { "profile": "head_readonly" }
        },
        "profiles": {
          "git_readonly": {
            "allowSubcommands": [["status"], ["diff"], ["remote", "add"]],
            "allowFlags": { "--no-pager": { "takesValue": false } }
          },
          "head_readonly": {
            "allowSubcommands": "all",
            "allowFlags": { "-n": { "takesValue": true, "value": { "type": "int", "min": 1, "max": 100 } } }
          }
        }
      }
    }
  }
}
```

Note: because profiles are `allowFlags`-only, any unlisted flag is denied (e.g. `--work-tree`, `-C`, `--bytes`).

## Policy model (fits how Greg actually works)

- **Filesystem** (fail-closed):
  - allow `rw` under workspace repo(s)
  - allow `rw` under `/tmp/greg/**`
  - deny everything else
  - support **protected subtrees** (e.g. allow repo writes but deny `repo/tools/**`)
- **Binaries**:
  - allowlist by **resolved absolute path**
  - treat runtimes/interpreters (`bash`, `sh`, `node`, `python`, `bun`) as higher risk; keep them tight / approval-gated where possible

## Parsing + validation semantics (make this unambiguous)

### Algorithm (generic)

Given `args` + profile:

- Parse left→right; support `--flag`, `--flag=value`, `-f`, `-f value`.
- Bundled `-abc` only if each flag exists in `allowFlags` with `takesValue:false`, else reject.
- Any flag not in `allowFlags` → reject.
- For `takesValue:true`, consume value (`--flag=value` or next token) and validate:
  - `type:"int"`: enforce `min/max`
  - `type:"path"`: resolve vs `cwd` (or workspace) and enforce FS roots + protected subtrees
- Subcommand tokens = `args` with recognized flags (+their values) removed. Enforce:
  - `"all"` or prefix-match any listed token-path

## Subprocess environment hardening (macOS)

Even with resolved-bin allowlisting, subprocess behavior can be influenced by env. Defaults should be safe:

- **PATH**: ignore/override user-provided `env.PATH` (set a minimal known-safe PATH, or require absolute resolved bins only).
- **Loader variables**: reject/strip `DYLD_*` variables (macOS), plus other exec-affecting variables as needed.
- **CWD**: default to workspace root when `cwd` not provided; if provided, enforce it is under allowed roots.

## Acceptance tests (must match real failure modes)

- **Bare filename**: within workspace allowed; outside denied.
- **Non-argv effects**: e.g. extraction/compilation can’t write outside allowed roots.
- **Pipeline semantics**: stdout/stderr behavior matches expected “merge then filter”.
- **Protected subtree**: repo writable but `repo/tools/**` not writable; git still works.

