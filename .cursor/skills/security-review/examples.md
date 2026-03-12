# Security review — example finding

Use this as a template for formatting per-area findings and recommendations.

## Example: LLM05 (Improper output handling)

**Area:** Exec / shell  
**Path:** `agent/tools/exec.ts`  
**Finding:** Tool X passes model-generated arguments directly to the shell without validation.  
**Recommendation:** Add schema validation and an allowlist for permitted commands or arguments (see OWASP LLM05). Prefer allowlist over blocklist so unknown commands are denied by default.

**Performance/cost:** Schema validation is low latency; allowlist maintenance is one-time. No extra runtime cost.
