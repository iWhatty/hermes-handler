# Codex and Windows Tooling Jank Log

This log records tooling friction observed while implementing the August 11, 2026 HermesHandler hardening work. It is diagnostic evidence, not product guidance and not a request to enable cloud automation.

The goal is to make later tuning concrete: preserve the exact symptom, identify the affected layer, record the workaround that succeeded, and avoid "fixes" that risk repository data or permissions.

## Session environment

- Host: Windows, PowerShell 5.1.22621.4249
- Repository path: `C:\Users\PC User\GitHub\HermesHandler-JS`
- Codex app package visible in error paths: `OpenAI.Codex_26.803.10989.0`
- RTK: 0.42.2
- Node.js: 24.11.1
- pnpm: 10.33.2 through Corepack
- Sandbox profile: workspace-write/restricted filesystem with the repository as a writable root
- Git branch: `main`, tracking `origin/main`

## Quick index

| ID | Area | Impact | Status during session |
| --- | --- | --- | --- |
| JANK-001 | Codex `apply_patch` sandbox | Blocked tracked-file edits | Persisted across every tracked-file product surface and all editing subagents |
| JANK-002 | External patch launcher | Blocked the nominal patch fallback | Reproduced; Windows returned access denied |
| JANK-003 | RTK + PowerShell cmdlets | Broke direct `Get-Content` inspection | Reproduced; use `rg` or an explicit PowerShell process |
| JANK-004 | RTK + batch arguments | Prevented invoking `apply_patch.bat` with patch text | Reproduced |
| JANK-005 | RTK hook warning | Added repeated output noise | Persistent but non-blocking |
| JANK-006 | PowerShell patch streams | Added CRLF/context friction to `git apply` | Reproduced; validated workaround succeeded |
| JANK-007 | Subagent inherited model routing | Initial subagent spawn failed | Reproduced on two work surfaces; explicit available model worked |
| JANK-008 | Shared subagent edit capability | Builders could investigate but could not patch | Reproduced across all editing builders |
| JANK-009 | Parallel tool aggregation | One failed command hid sibling results | Reproduced in inspection and focused-verification batches |
| JANK-010 | RTK-to-RTK pipelines | A file-list filter unexpectedly returned no matches | Reproduced once; standalone command worked |
| JANK-011 | PowerShell patch encoding | Corrupted non-ASCII punctuation without failing checks | Reproduced while creating this log |
| JANK-012 | Tool-call orchestration source | Combined launchers failed before execution | Reproduced; smaller or escaped retries worked |
| JANK-013 | RTK + Windows glob forwarding | A quoted test glob reached `rg` literally and caused OS error 123 | Reproduced once in a read-only audit |
| JANK-014 | Shell sandbox helper | A read-only `rg` inspection hit the same deny-read ACL helper failure | Reproduced; escalation succeeded |
| JANK-015 | RTK command availability | `rtk sed` could not resolve a `sed` binary on this Windows host | Reproduced; native PowerShell range reads worked |
| JANK-016 | Zero-context patch placement | A checked multi-hunk test insertion landed inside existing blocks | Reproduced; syntax/focused tests caught it before integration |
| JANK-017 | Codex `apply_patch` recovery | The tracked-file patch helper began succeeding without ACL changes | Observed after repeated same-session failures |

## Detailed observations

### JANK-001: `apply_patch` could not read tracked files

The built-in patch tool consistently failed while reading an existing tracked file:

```text
windows sandbox failed: helper_unknown_error: apply deny-read ACLs
```

Observed behavior:

- Read-only shell commands succeeded when retried with the normal sandbox escalation mechanism.
- `apply_patch` could not update tracked files such as `tsconfig.build.json`.
- A new Codex task/thread did not clear the problem.
- Narrow editing subagents inherited the same failure.
- Repository ACL inspection in the earlier task found no meaningful permission difference between tracked and new files.
- The failure reproduced again while creating this log and linking it from a tracked document.

Impact: P1 for implementation work because the required editing path was unavailable.

Safe workaround used:

1. Do not reset repository ACLs.
2. Do not overwrite files with shell redirection.
3. Construct an exact unified diff.
4. Run `git apply --check` first.
5. Apply only after validation.
6. Finish with `git diff --check`, focused tests, and the full verification suite.

Tuning lead: inspect the Windows sandbox helper's deny-read ACL application and token lifetime. The failure appears to be in the helper boundary, not the repository ACLs.

### JANK-002: the discovered external patch launcher was not executable

`where.exe apply_patch` found a temporary wrapper:

```text
C:\Users\PC User\.codex\tmp\arg0\...\apply_patch.bat
```

The wrapper pointed to:

```text
C:\Program Files\WindowsApps\OpenAI.Codex_26.803.10989.0_x64__2p2nqsd0c76g0\app\resources\codex.exe --codex-run-as-apply-patch
```

Both the wrapper and direct executable path failed with:

```text
Access is denied.
```

This happened even through an escalated shell request. The launcher therefore did not provide an independent fallback from JANK-001.

Tuning lead: verify WindowsApps execution permissions and whether the temporary wrapper is expected to be callable from the managed shell environment.

### JANK-003: RTK cannot directly execute PowerShell cmdlets

This form failed:

```powershell
rtk proxy Get-Content -Raw path\to\file
```

RTK treated `Get-Content` as an external binary and reported that it was not on `PATH`.

Working alternatives:

- Use `rtk rg -n "^" path\to\file` for compact file inspection.
- When PowerShell semantics are required, invoke `powershell.exe` explicitly through RTK.

Tuning lead: document this boundary in RTK's PowerShell usage, or teach RTK to recognize shell built-ins/cmdlets when its parent shell is PowerShell.

### JANK-004: RTK rejected batch-file patch arguments

Passing a patch string to the discovered batch wrapper through RTK produced:

```text
[rtk: batch file arguments are invalid]
```

Piping through `cmd.exe /c apply_patch` then reached the separate access-denied failure in JANK-002.

Tuning lead: add a tested Windows batch-file argument path, especially for multiline arguments, or explicitly document unsupported invocation shapes.

### JANK-005: RTK repeatedly reported that no hook was installed

Many otherwise successful commands appended:

```text
[rtk] /!\ No hook installed -- run `rtk init -g` for automatic token savings
```

This was non-blocking but noisy, particularly in verification output and parallel command batches. No global hook was installed automatically because that would mutate user-level tooling outside the requested repository work.

Tuning lead: consider once-per-session reporting, a quiet mode, or a repository-local opt-out. Review whether `rtk init -g` is appropriate before running it manually.

### JANK-006: PowerShell-to-`git apply` streams had line-ending and hunk friction

After both patch mechanisms were unavailable, exact unified diffs were passed to `git apply` through PowerShell here-strings. This exposed several hazards:

- PowerShell's stream encoding/CRLF behavior caused "trailing whitespace" warnings on inserted lines.
- Normal context matching sometimes failed against CRLF files.
- Codex `apply_patch`'s simplified hunk syntax is not valid unified-diff syntax; converting it mechanically produced "patch with only garbage" or "corrupt patch" errors until exact hunk counts were supplied.
- A syntactically valid hunk with an undercount applied successfully while omitting intended trailing lines; `git apply --check` cannot detect intent, so re-reading and language syntax checks remain necessary.

The successful fallback used:

```powershell
git apply --check --ignore-space-change --ignore-whitespace -
git apply --ignore-space-change --ignore-whitespace -
```

For exact single-line replacements, `--unidiff-zero` was also used. Every applied patch was followed by `git diff --check`; the final result had no whitespace errors.

Tuning lead: provide a first-class patch-input channel that bypasses PowerShell text encoding, or expose the internal patch engine through a permitted executable path.

### JANK-007: inherited subagent model routing selected an unavailable model

The first full-history subagent spawn failed with:

```text
Unknown model `gpt-5.6-luna` for spawn_agent.
Available models: gpt-5.6-sol, gpt-5.6-terra
```

The parent did not explicitly request `gpt-5.6-luna`. The same inherited-model failure recurred on a later work surface. The workaround was to use a bounded or context-free fork with an explicitly available `gpt-5.6-terra` model and put the required context into the task message.

Impact: the workaround succeeded but lost automatic conversation inheritance and required duplicated task context.

Tuning lead: validate inherited model names before dispatch, or fall back automatically to an advertised compatible model.

### JANK-008: editing subagents shared the same broken patch boundary

Read-only investigators and the final reviewer were useful. All narrow builder agents independently hit the same `apply_patch`/access-denied failures and returned implementation designs without edits.

Practical consequence: under this failure mode, delegate discovery and review, but keep edits in the primary task where a carefully audited fallback can be applied once. Repeated builder attempts add latency without increasing capability.

Tuning lead: expose sandbox-helper health/capability to the orchestrator before it dispatches edit tasks, or give subagents an error classification that prevents identical retries.

### JANK-009: one expected command miss rejected an entire parallel inspection batch

A parallel `Promise.all` batch included `rg` against `src/client.d.ts` before that file existed. `rg` returned exit code 1, causing the orchestration call to fail and hiding successful sibling results from the direct response.
The same aggregation behavior recurred when a Vitest parse failure caused the combined focused-test/lint/diff launcher to return only the failed test output. Rerunning syntax, tests, lint, and diff checks separately preserved clear evidence.


Working practice:

- Guard optional files with `Test-Path`.
- Do not combine expected-miss probes with required commands in one failure-coupled batch.
- Return each result independently when partial evidence is useful.

This is partly orchestration ergonomics rather than a repository bug.

Tuning lead: consider an `allSettled` helper/example for parallel tool composition and preserve successful sibling outputs when one call fails.

### JANK-010: an RTK-to-RTK file-list pipeline unexpectedly returned no matches

This pipeline produced no README matches:

```powershell
rtk rg --files examples | rtk rg "README\.md$"
```

Running `rtk rg --files examples` alone immediately showed the expected README files. The session avoided further chained RTK filters and used one direct command per inspection.

Tuning lead: reproduce whether RTK's output filtering, Windows path separators, or pipeline stdin handling caused the empty result.
### JANK-011: PowerShell patch streaming corrupted non-ASCII punctuation

While creating this log, curly quotes, curly apostrophes, and an em dash in the PowerShell here-string arrived in the file as literal `?` characters.

Impact: content remained syntactically valid, so Markdown link checks and `git diff --check` did not detect the corruption.

Working practice: keep emergency patch payloads ASCII-only and explicitly search new documentation for unexpected question marks. A byte-safe patch channel would remove this hazard.

Tuning lead: test and document the encoding used when PowerShell 5.1 pipes here-string content into native executables.

### JANK-012: a combined orchestration cell failed before running commands

A `functions.exec` JavaScript cell intended to launch the final pack, diff, status, and workflow checks failed during source evaluation:

```text
SyntaxError: Unexpected string
```

No nested shell command ran, so this did not affect the repository or invalidate earlier checks. The same commands succeeded when the pack check was run separately and the three read-only checks were composed in a smaller cell.

This is recorded as orchestration jank, but it may have been a malformed generated JavaScript expression rather than a defect in the tool runtime. The useful product behavior was that evaluation stopped before any partial execution.

Working practice:

- Keep final evidence batches small.
- When orchestration source evaluation fails, state explicitly that no nested operation ran and rerun the checks individually.

Tuning lead: include the parser source location or failing token in `functions.exec` syntax errors so generated-code mistakes can be distinguished quickly from runtime failures.

### JANK-013: RTK forwarded a Windows test glob literally

During a read-only delegated audit, a command passed this path pattern to `rg`:

```text
test\transports\*.test.js
```

The wildcard reached `rg` as a literal Windows path and produced OS error 123 instead of expanding to matching files. Direct file paths and `rtk rg --files` inspection worked.

Working practice: use `rtk rg --files <directory>` and filter the returned paths, or pass explicit paths, rather than relying on PowerShell wildcard expansion through RTK.

Tuning lead: document RTK's Windows wildcard behavior or normalize supported glob arguments before launching the wrapped command.

### JANK-014: the sandbox deny-read failure also affected a read-only shell command

A fresh task token failed on a read-only `rtk rg` inspection with the same helper family seen by `apply_patch`:

```text
windows sandbox: helper_unknown_error: apply deny-read ACLs
```

The exact inspection succeeded unchanged through the normal read-only sandbox escalation path. No repository ACLs were modified.

Tuning lead: determine why a shell read was routed through an error path labelled `apply deny-read ACLs`, and whether the diagnostic is accurately identifying the failing helper stage.

### JANK-015: RTK could not provide `sed` on the Windows host

Attempts to use `rtk sed -n ...` for bounded source inspection failed with:

```text
rtk: Failed to resolve 'sed' via PATH, falling back to direct exec: Binary 'sed' not found on PATH
[rtk: program not found]
```

Native PowerShell `Get-Content` range reads worked when run through the approved escalation path.

Tuning lead: document which Unix-style inspection commands RTK bundles or expects on Windows, or provide an RTK-native bounded line-range command.

### JANK-016: a checked zero-context patch placed insertions inside existing blocks

A generated multi-hunk `git apply --check --unidiff-zero` patch succeeded, but two insertions used physical worktree line numbers that were unstable relative to the accumulated diff. The apply placed new tests inside existing constructor/test blocks. `node --check` caught the first malformed placement; after a move-only repair, the focused test run caught the remaining valid-JavaScript nested test.

No product test ran successfully against the malformed placement, and the repair moved only the newly inserted blocks plus one existing closing line.

Working practice:

- Prefer unique surrounding context over physical line anchors.
- Re-read exact insertion neighborhoods after every zero-context apply.
- Run both syntax checks and focused tests; valid JavaScript can still have invalid test structure.

Tuning lead: improve the emergency patch workflow so worktree-relative anchors can be generated reliably, or restore the normal patch helper so zero-context patches are unnecessary.

### JANK-017: the tracked-file patch helper recovered without permission changes

During the postMessage setup rollback surface, `apply_patch` first failed to match lines because a delegated edit had already landed. On the next tracked-file patch, it read and updated both source and test files successfully. A subsequent cleanup patch also succeeded.

No repository ACL, sandbox profile, process permission, or working-directory change was made between the earlier `apply deny-read ACLs` failures and these successes. This differs from JANK-001: the important evidence is recovery within the same task rather than persistence of the failure.

Tuning lead: correlate patch-helper sandbox tokens and helper process lifetime with the exact failure/recovery timestamps. A diagnostic identifier in each patch result would make intermittent state transitions traceable.

## MCP and connector coverage


No MCP server, app connector, browser connector, or external SaaS plugin was used during this implementation. No MCP-specific bug was observed. This absence should remain explicit so later reviews do not incorrectly attribute the shell/sandbox failures to MCP.

## What worked reliably

- Escalated read-only shell inspection after the sandbox helper failed.
- `rtk corepack pnpm ...` for tests, builds, lint, TypeScript, and package dry runs.
- Read-only investigator/reviewer subagents with explicit available models.
- Required-subset public export checks.
- `git apply --check` followed by a narrowly scoped apply and `git diff --check` as an emergency fallback.
- Programmatically deriving insertion hunk counts from line arrays, followed by source re-read and syntax checks.
- Full local verification: runtime tests, source and package TypeScript checks, examples, documentation links, lint, and package dry run.

## Review checklist

When revisiting this log:

1. Reproduce JANK-001 with a one-line tracked-file patch in a disposable repository.
2. Compare the sandbox token/helper behavior between new-file creation and tracked-file updates.
3. Verify whether the WindowsApps Codex executable is intentionally inaccessible to the managed shell.
4. Test RTK with PowerShell cmdlets, batch arguments, and stdin pipelines on the recorded versions.
5. Test subagent spawning with inherited model context and confirm the model is in the advertised availability list.
6. Decide whether RTK's global hook warning should be silenced, initialized, or documented locally.
7. Keep `.github/workflows/ci.yaml.disabled` disabled while investigating; these issues are local tooling concerns and do not require cloud CI.
