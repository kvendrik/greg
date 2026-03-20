---
name: security-review
description: Review LLM/agent security using research-backed aspects—prompt injection, output handling, user-in-the-loop, privilege separation, and performance/cost tradeoffs. Use when the user asks for a security review, threat assessment, or to harden the agent.
---

# LLM Security Review

**When to use:** Security review, threat assessment, or hardening of an LLM-based agent. For a **quick check**, use the OWASP table (§1), lethal trifecta (§2), and “Where to look” (§7). For a **full review**, work through all sections including agentic risks (§1b), defense in depth (§6), and the review output format below.

Consider all aspects below and where to look in the codebase. Balance safety with **performance and cost**; note the impact of each measure.

## 1. Threat model and taxonomy (OWASP LLM Top 10)

Use [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications) (2025) as the checklist:

| ID        | Risk                             | What to check                                                                                    |
| --------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| **LLM01** | Prompt injection                 | Inputs that can override system behavior; indirect injection via tool outputs (web, email, RAG). |
| **LLM02** | Sensitive information disclosure | PII, credentials, or confidential data in prompts, logs, or tool outputs.                        |
| **LLM03** | Supply chain                     | Model source, third-party APIs, plugins, and dependencies.                                       |
| **LLM04** | Data/model poisoning             | Training or RAG data that could bias or backdoor behavior.                                       |
| **LLM05** | Improper output handling         | Using LLM output (e.g. tool args, code, URLs) without validation or sanitization.                |
| **LLM06** | Excessive agency                 | Tools with broad permissions; no least-privilege or approval for dangerous actions.              |
| **LLM07** | System prompt leakage            | System prompts or internal instructions exposed to users or in logs.                             |
| **LLM08** | Vector/embedding weaknesses      | RAG retrieval poisoning, insecure embeddings or indexes.                                         |
| **LLM09** | Misinformation                   | Unverified external content presented as fact.                                                   |
| **LLM10** | Unbounded consumption            | No rate limits, token caps, or cost controls; DoS via long runs or huge context.                 |

## 1b. Agentic applications (OWASP Agentic)

For agentic apps (LLM + planning, memory, tools), also use [OWASP Securing Agentic Applications Guide](https://genai.owasp.org/resource/securing-agentic-applications-guide-1-0/) and [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/). Key surfaces: **orchestration** (loss of control, rogue agents), **planning** (poisoned decision chains), **memory** (context leakage, cross-user), **tool integration** (RCE, misuse), **execution environment** (API abuse, code injection). Map these to "Where to look" (orchestrator vs subagents, session/memory isolation, tool policy, sandboxing).

## 2. The “lethal trifecta” (indirect prompt injection)

Indirect prompt injection is most dangerous when **all three** are true:

1. **Access to private data** — agent can read emails, files, DBs, env vars.
2. **Exposure to untrusted content** — agent processes web pages, fetched docs, user uploads, or third-party APIs.
3. **Ability to communicate externally** — agent can send email, HTTP, or other outbound requests.

**Where to look:** Any tool that (a) returns untrusted text that is fed back to the LLM (e.g. `web_fetch`, search, RAG), and (b) is used in a flow where the agent can also call tools that exfiltrate (e.g. `exec`, email, HTTP). Mitigations: guard/sanitize untrusted content before it reaches the model; restrict which tools can run after processing untrusted content; user-in-the-loop for sensitive actions.

**Inference-time / intent-based defenses:** When rule-based or classifier-only guards are insufficient, consider inference-time correction (e.g. ICON — attention steering to remove adversarial dependencies) or intent-analysis defenses (e.g. IntentGuard — neutralize instruction overlap with untrusted data). These can reduce IPI success rates with minimal utility loss. See [reference.md](reference.md) for sources. Microsoft’s defense-in-depth for IPI combines hardened prompts, detection (Prompt Shields), and impact mitigation (data governance, blocking exfiltration).

## 3. User-in-the-loop (human approval)

- **When:** For actions that are irreversible, high-impact, or compliance-sensitive (exec, send email, delete, pay, change production).
- **Patterns:** Pre-exec approval with clear options (deny / once / always); allowlists for trusted commands or hosts; “trust ladder” — start locked, auto-approve only after user confirms.
- **Requirements:** Pause before execution, show context (e.g. command or payload), store audit trail, handle timeouts and rejections.

**Where to look:** `agent/tools/utilities/guard/policy/` (exec policy, allowlist), `agent/tools/exec.ts` (pre-exec `evaluatePolicy`), approval UX in Telegram/CLI (`sendMessage(..., { awaitReply: true })`).

## 4. Input/output guards and classifiers

- **Input:** Classify or filter user and tool-supplied content before it is sent to the LLM (e.g. prompt injection / malicious patterns).
- **Output:** Validate or classify model output (e.g. tool-call args, generated code, URLs) before execution or display.
- **Options:** Rule-based (regex/patterns), LLM-based classifiers (e.g. Llama Guard), or hybrid. Rule-based is cheap and fast; classifier adds latency and cost but catches more.

**Performance/cost:**

- **Patterns only:** Negligible latency/cost; can miss novel attacks.
- **Classifier (e.g. 7B):** Extra latency (hundreds of ms to seconds), extra GPU or API cost; use timeouts and “classifier down” fallback (e.g. deny or patterns-only).
- **Compact classifiers (e.g. Llama Guard 3-1B-INT4):** Lower latency and cost, suitable for mobile/edge; benchmark before relying on them.
- **Multiple guardrails:** Each extra check adds latency; stacking many can **roughly triple** end-to-end latency and cost (see NeMo Guardrails–style studies). Prefer a small set of high-value checks.
- **Over-refusal:** Blocking high-risk actions in ambiguous multi-turn flows can break valid workflows. Prefer allowlists and user-in-the-loop over blanket deny when possible.

**Where to look:** `agent/tools/utilities/guard/` (`guard.ts`, `patterns.json`, classifier service); web fetch may live under `agent/tools/web/` or similar — confirm in the repo (guard on fetched content, size caps, SSRF). Config: `guard.enabled`, `guard.use` (patterns vs classifier vs all).

## 5. Tool safety and privilege separation

- **Least privilege:** Each tool should have the minimum permissions needed; avoid “run anything” unless explicitly gated by policy.
- **Pre-exec policy:** For dangerous tools (exec, shell, email, etc.), enforce allowlists, blocklists, or pattern checks before execution.
- **Sandboxing:** Where possible, run agent-driven code or scripts in sandboxes (e.g. WASM, containers) to limit impact of malicious or buggy output.

**Where to look:** `agent/tools/exec.ts`, `agent/tools/utilities/guard/policy/` (allowlist, `evaluatePolicy`), `agent/tools/browser.ts` and other high-capability tools. Cron/heartbeat and subagents (if present) — same policy and guard semantics.

## 6. Defense in depth

Combine layers; do not rely on a single control:

1. **Input:** Sanitize or classify user and tool-origin inputs (e.g. web_fetch content).
2. **Output:** Validate/sanitize LLM output before using it (e.g. tool arguments, generated commands).
3. **Privilege:** Limit which tools and data the agent can access.
4. **Execution:** Pre-exec policy and user approval for sensitive tools; sandbox where feasible.

## 7. Where to look in this codebase (Greg / OpenClaw-style)

Paths may vary; confirm in the repo. Guard and exec policy are under `agent/tools/utilities/guard/` and `agent/tools/exec.ts`; web fetch/search may be under `agent/tools/web/` or similar.

| Area                          | Path / component                                             | What to review                                                          |
| ----------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Guard (patterns + classifier) | `agent/tools/utilities/guard/`                               | Patterns, classifier usage, timeout, fallback when classifier is down.  |
| Exec policy & approval        | `agent/tools/utilities/guard/policy/`, `agent/tools/exec.ts` | Pre-exec check, allowlist, deny/once/always UX.                         |
| Web fetch (untrusted content) | e.g. `agent/tools/web/` or web-fetch                         | Guard on fetched content, size caps, SSRF handling, allowlist per host. |
| Web search                    | Same or sibling of web tools                                 | Whether search results are guarded before being fed to the model.       |
| Cron / heartbeat              | `agent/tools/cron/`, `gateway/heartbeat/`                    | Same guard and policy semantics; no privilege escalation.               |
| Sessions and storage          | `gateway/sessions/`, session storage                         | No sensitive data in logs or transcripts; retention.                    |
| Config                        | `config` types                                               | Guard enabled by default or opt-in; which tools are enabled.            |

## 8. Performance and cost summary

| Measure                               | Typical impact               | When to use                                                          |
| ------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Pattern/regex blocklist               | Low latency, no extra cost   | Always for known-bad patterns (e.g. “ignore previous instructions”). |
| Output validation (schema, allowlist) | Low                          | Always for tool arguments and generated commands.                    |
| User-in-the-loop approval             | User-time only               | High-risk, irreversible, or compliance-sensitive actions.            |
| LLM-based input/output classifier     | +latency, +cost (GPU or API) | When rule-based is insufficient; use timeouts and fallback.          |
| Multiple guardrail layers             | Cumulative latency and cost  | Minimize; prefer a few high-value checks.                            |
| Compact classifier (e.g. 1B-INT4)     | Lower than 7B+               | When balancing safety vs latency/cost on constrained hardware.       |

When recommending controls, state whether they add latency or cost and suggest fallbacks (e.g. “if classifier unavailable, deny” or “patterns-only”) so the system stays safe and predictable under failure.

## Review output format

Produce the following for each review:

1. **Threat model summary** — Which of LLM01–LLM10 (and agentic risks from §1b) apply.
2. **Lethal-trifecta assessment** — Which of the three legs exist and whether mitigations are in place.
3. **Per-area findings** — Guard, exec policy, web, cron, sessions, config; include path references and one-line recommendations.
4. **Performance/cost note** — For any suggested guardrails, note added latency or cost and fallbacks.
5. **Condensed findings by tier** — Always condense the findings into explicit tiers and present them as the main takeaway:
   - **Tier 1 — High impact:** Critical gaps (e.g. unguarded untrusted content reaching the model, missing guard on a high-risk tool).
   - **Tier 2 — Medium impact:** Important improvements (e.g. guard opt-in vs default, unattended-run behavior, session retention, PII).
   - **Tier 3 — Lower impact / operational:** Documentation, operator visibility, rate/token limits, allowlist docs.

   When saving a review (e.g. to `planning/security.md` or similar), use this tiered structure as the primary format so the user can act on high-impact items first.

See [examples.md](examples.md) for a sample finding.

## Additional resources

- For sources, benchmarks, and deeper reading: [reference.md](reference.md).
