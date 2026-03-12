# Security review — references and further reading

Use this when you need sources, benchmarks, or deeper detail during a security review.

## OWASP and standards

- **OWASP Top 10 for LLM Applications (2025):**  
  https://owasp.org/www-project-top-10-for-large-language-model-applications  
  https://genai.owasp.org/llm-top-10/
- **OWASP Securing Agentic Applications Guide 1.0:**  
  https://genai.owasp.org/resource/securing-agentic-applications-guide-1-0/
- **OWASP Top 10 for Agentic Applications 2026:**  
  https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- **OWASP AI Agent Security Cheat Sheet:**  
  https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- **OWASP LLM Prompt Injection Prevention Cheat Sheet:**  
  https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- **OWASP GenAI Security Project:**  
  https://genai.owasp.org/

## Prompt injection and indirect injection

- **Lethal trifecta** (private data + untrusted content + external communication):  
  Simon Willison, "The lethal trifecta for AI agents" (e.g. simonw.substack.com, simonwillison.net).
- **Anatomy of indirect prompt injection:**  
  Pillar Security, "Anatomy of an Indirect Prompt Injection"; research on poisoning external content (web, email) that the model then obeys.
- **XPIA / indirect injection:**  
  OWASP LLM01; attacks where instructions are hidden in documents, web pages, or tool outputs rather than in the user's direct message.
- **ICON (inference-time correction):**  
  arXiv:2602.20708 — detects IPI via over-focusing signatures in latent space, attention steering to remove adversarial dependencies; low attack success rate with preserved utility.
- **IntentGuard (intent analysis):**  
  arXiv:2512.00966 — analyzes which input segments the LLM treats as instructions, neutralizes overlap with untrusted data; reduces IPI success with minimal utility loss.
- **Microsoft defense-in-depth for IPI:**  
  https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks — hardened prompts, Prompt Shields, data governance, blocking exfiltration.
- **InjecAgent (benchmark):**  
  arXiv:2403.02691 — benchmarking indirect prompt injections in tool-integrated LLM agents; useful for evaluation and testing.

## Guardrails and output classifiers

- **Llama Guard (Meta):**  
  "Llama Guard: LLM-based Input-Output Safeguard for Human-AI Conversations" (arXiv:2312.06674); 7B safeguard for prompt and response classification.
- **Llama Guard 3-1B-INT4:**  
  "Compact and Efficient Safeguard" (Meta, 2024); ~30 tok/s, &lt;2.5 s TTFB on mobile CPUs; comparable safety to larger guards with lower cost/latency.
- **GPT-OSS Safeguard (OpenAI):**  
  Reasoning-based safeguard with configurable effort (low/medium/high) for latency vs thoroughness.
- **NeMo Guardrails (NVIDIA):**  
  Research indicating robust guardrails can roughly **triple** latency and cost; multiple prompt-engineered guardrails (e.g. 12) can inflate cost 4× vs base model.

## Agent and tool safety

- **ToolSafe:**  
  "Enhancing Tool Invocation Safety of LLM-based agents via Proactive Step-level Guardrail and Feedback"; step-level guardrail before tool execution; reduced harmful invocations ~65%.
- **GuardAgent:**  
  Dedicated guardrail agent that checks target agent actions against safety requirements; high accuracy on safety benchmarks.
- **Progent:**  
  "Programmable Privilege Control for LLM Agents"; DSL for fine-grained tool permission; deterministically enforced at runtime.
- **AegisLLM:**  
  Multi-agent defense (orchestrator, deflector, responder, evaluator) for self-reflective, test-time defense without retraining.

## Human-in-the-loop and approval

- **InferAct:**  
  "Inferring Safe Actions for LLM-Based Agents Through Preemptive Evaluation and Human Feedback"; preemptive detection of errors before critical actions.
- **Trust ladder:**  
  Start with approval required; gradually auto-approve only patterns or commands the user has explicitly trusted.
- **Risk matrix:**  
  Reversibility and impact; high-risk (e.g. delete, pay, external send) always require approval; low-risk (read-only) can be autonomous.

## Cost and performance

- **Dynamo AI:**  
  "Breaking the Bank on AI Guardrails? How to Minimize Costs Without Compromising Performance" — strategies to reduce guardrail cost.
- **Modelmetry:**  
  "Latency of LLM Guardrails" — sources of guardrail latency (serialization, validation, network).
- **Milvus:**  
  "How do guardrails impact the cost of deploying LLMs?" — cost factors (model size, prompt tokens, policy complexity).

## This codebase (Greg)

- **Guard:**  
  `agent/tools/utilities/guard/` — patterns (regex) + optional ModernBERT-based classifier service; config: `tools.guard.enabled`, `tools.guard.use`, `tools.guard.allowlist`.
- **Exec policy:**  
  `agent/tools/utilities/guard/policy/` — allowlist, command parsing, deny/once/always approval via Telegram.
- **OpenClaw-style:**  
  Heartbeat, pre-exec approval, and guard are inspired by OpenClaw; see `planning/TODO.md`, `gateway/heartbeat/`, and README.
