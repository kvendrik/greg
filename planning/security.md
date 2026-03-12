# Security review — Greg / OpenClaw-style agent

Review date: 2025-03-12. Based on OWASP Top 10 for LLM Applications (2025), OWASP Securing Agentic Applications, and the project security-review skill.

---

## Tier 1 — High impact

1. **Guard web search result content**  
   When `tools.guard.enabled`, run search result text (answer + snippets) through the same guard as web_fetch (or at least patterns). Closes indirect prompt injection via search (LLM01 / lethal trifecta). Use same `isSafe`/`available` and config as web_fetch; document that “guard applies to web_fetch and web_search content.”

---

## Tier 2 — Medium impact

2. **Guard and production use**  
   Document that enabling the guard is recommended for production; consider enabling by default with opt-out. Sample `.greg.ts` does not set guard today.

3. **Unattended cron/heartbeat + exec**  
   Document: for unattended cron/heartbeat that may use exec, put required commands on the exec allowlist so policy does not block on “no user reply.” Consider timeout/UX when no user is available.

4. **Sessions and retention**  
   Document retention expectations; consider optional TTL or cleanup for compliance. Ensure session files are not logged verbatim or exposed to untrusted users (LLM02); consider PII redaction for analytics.

---

## Tier 3 — Lower impact / operational

5. **Classifier and guard docs**  
   Document “classifier down” behavior (deny) and optional patterns-only fallback. Consider logging when the classifier is down so operators notice.

6. **Exec and webFetch allowlist docs**  
   Document allowlist format and “trusted” vs “allow” semantics for operators. Document webFetch allowlist per-host for operators.

7. **Rate/token limits (LLM10)**  
   Consider per-session or per-user rate limits or token caps for production; document guard recommendation in config.
