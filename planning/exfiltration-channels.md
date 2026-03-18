## Exfiltration channels plan

Goal: prevent a malicious prompt / indirect injection from making Greg **send sensitive data outward** (network, messaging, git remotes, etc.), even if exec/files are well sandboxed.

### Score target

**9 / 10** protection against exfil once implemented (remaining risk is user-approved leaks).

## Threat model (what we’re stopping)

- **Indirect prompt injection**: untrusted content (web/email/docs) instructs the agent to “upload/send” secrets.
- **Tool-chaining**: read from workspace → summarize → send via outbound tool.
- **Covert exfil**: long outputs, chunking, or embedding secrets in “innocent” payloads.

## Inventory (must do first)

List every tool/path that can move data off-box:

- **HTTP**: any fetch/post client, webhook, MCP, external API calls
- **Messaging**: Telegram/Slack/Email/SMS/voice call senders
- **Git/network exec**: `git push`, `curl`, `wget`, package managers, ssh/scp/rsync
- **Browser automation**: form submits / uploads
- **Logs/telemetry**: any remote logging sink

For each, define:

- **Destination**: host / chat ID / email / repo remote
- **Direction**: send vs receive
- **Payload type**: text/json/file/binary

## Policy model (default-deny outbound)

### A) Outbound destinations allowlist

Policy should be explicit and minimal:

- **Allowed hosts** (scheme + host + optional port)
- **Allowed chat/email recipients**
- **Allowed git remotes**

Everything else: deny (or ask-gated once, depending on mode).

### B) Data classification gates (cheap, rule-based first)

Before any outbound send, run a local check on the payload:

- **Size caps**: hard cap bytes per request/message; deny if exceeded.
- **Secret patterns**: block obvious credentials (API keys, tokens, private keys, `.env`-like content).
- **Workspace path leakage**: block dumping entire files; require explicit user approval for file attachments.

If uncertain: require `/once` (ask mode) and show a payload preview + destination.

### C) Mode separation (aligned with `exec-sec.md`)

- **Default mode**: outbound is allowed only if destination is allowlisted and payload passes checks.
- **Ask mode**: if blocked, allow `/once` per request, with destination + payload preview.
- **High-risk actions**: always ask (e.g. new destination, file upload, large payload, anything flagged as “secret-like”).

## Implementation order (LLM checklist)

1. **Centralize outbound sending**
   - Ensure every outbound-capable tool routes through a shared helper, e.g. `evaluateOutboundPolicy({ destination, payload, kind })`.
2. **Add config + types**
   - `tools.guard.outbound.allowedHosts`, `allowedRecipients`, `allowedGitRemotes`
   - per-tool overrides optional (still default-deny)
3. **Pre-send validation**
   - destination allowlist check
   - payload checks (size + secret patterns + attachment rules)
   - structured deny reasons (user-facing)
4. **Ask mode integration**
   - if denied and `tools.guard.ask:true`, prompt `/once` with destination + redacted payload preview
5. **Audit trail**
   - log outbound attempts (allowed/denied/once) with destination, sizes, and reason (no full secret payloads in logs)

## Acceptance tests

- **Destination default-deny**: unknown host/recipient is blocked (or ask-gated).
- **Payload caps**: large payloads are denied.
- **Secret patterns**: private key / token-like strings are blocked from outbound sends.
- **Once approval**: `/once` allows only that single request; next identical request is denied again.
- **No silent file upload**: sending file contents requires explicit approval and preview.

## Tiered rollout

- **Tier 1 (high impact)**: allowlist destinations + ask-gated new destinations + size caps.
- **Tier 2 (medium impact)**: secret-pattern blocking + attachment policy + audit trail.
- **Tier 3 (lower/ops)**: per-tool overrides, richer classifiers (optional), and better UX for previews/redaction.

