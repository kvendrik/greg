## OpenClaw comparison (security & exec)

**Concepts**

- **Output guard**: Greg’s guard only inspects _content that tools return to the LLM_ (exec stdout/stderr, web*fetch body). It does not block a command before it runs or scan user input. So it mitigates \_indirect* prompt injection (e.g. malicious text from a webpage or from `cat` of a file), not _direct_ injection in the user message or in the `command` string.
- **Pre-exec gate**: OpenClaw can require approval and/or allowlist _before_ exec runs (sandbox vs gateway, `exec-approvals.json`, security modes). Greg runs every allowlisted command immediately on the host; there is no sandbox and no approval step.
- **Allowlist vs guard**: In Greg, the guard runs on exec output _only when the command is not in the safe-commands allowlist_. So allowlisted commands (e.g. `cat`, `rm`) never have their output scanned—the risk is inverted (more “trusted” → less checking).

**Findings**

- [ ] **Exec: guard all exec output**  
       Run the guard on exec output whenever the guard is enabled, including for allowlisted commands. Today only _non_-allowlisted commands get output scanned; `cat`/`head`/`tail` of malicious or sensitive files bypass the guard.
- [ ] **Exec: pre-exec validation**  
       Add a check _before_ `spawn`: block (or require approval for) destructive patterns (e.g. `rm -rf`, `rm -rf /`, `mkfs`, `dd of=`) and optionally restrict paths (e.g. `*.env`, `*secret*`). OpenClaw uses path allowlist + safe bins + approval; Greg has no pre-exec policy.
- [ ] **Exec: no sandbox**  
       OpenClaw can run exec in a sandbox container (`host=sandbox`); Greg always runs on the host. Consider documenting that exec is host-unrestricted or adding a sandbox option later.
- [ ] **Exec: no approval flow**  
       OpenClaw has `exec-approvals.json`, approval-pending status, and allow/deny/allow-once. Greg has no human-in-the-loop for exec. Optional: add approval for high-impact or non-allowlisted commands.
- [ ] **Guard: input and params not scanned**  
       User message and tool parameters (e.g. `command`, `url`) are not passed through the guard. Direct prompt injection in the user message or in the `command` string is not detected. Optional: run guard on user message and/or sensitive params.
- [ ] **No secrets/PII redaction**  
       Guard only flags injection/jailbreak and replaces with a message; it does not redact API keys, tokens, or PII. OpenClaw-shield has a separate output scanner for that. Optional: add a redaction pass on tool output (and any future memory persistence).

**Summary**

| Area           | OpenClaw                                  | Greg                                                                       |
| -------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Exec host      | Sandbox (default) or gateway/node         | Host only                                                                  |
| Exec approval  | Yes (exec-approvals, on-miss/always)      | No                                                                         |
| Pre-exec check | Path allowlist, safe bins, chaining rules | None (allowlist only; command runs as-is)                                  |
| Output guard   | Via plugins (e.g. openclaw-shield)        | Yes (patterns + ModernBERT), but only for non-allowlisted exec + web_fetch |
| Secrets/PII    | Redaction in shield                       | None                                                                       |

---

## Features

- [ ] Telegram crashes when you ask Greg to restart
- [ ] Add CLIs for WhatsApp, Telegram, and iMessage to include messaging in morning updates
- [ ] Give Greg a way to make calls

## Tomorrow

- [ ] pre‑exec approval exists, but pre‑exec policy for auto‑blocking dangerous patterns is still not implemented.
- [ ] Weather retry strategy: limit to 1–2 distinct failures, then mark weather as unavailable and move on to avoid latency and noise.
- [ ] Guard ergonomics: introduce risk tiers so low-risk, read-only commands (like simple `curl` fetches) don’t require explicit approval, while higher-risk write/sending operations still do.

## Bugs

- [x] After a `/stop` call and a new prompt the agent continues where it left off
- [ ] Sometimes number don't have spaces before them in messages
- [ ] `search_past_conversations` throws errors

Optional

- [ ] When a tool has an error Greg should report it by creating a GH issue for himself
- [ ] Notes save things like "Showed Koen Pragmatic Engineer email" but it doesn't then also save the link. This is where full thread transcripts search would come in handy.
