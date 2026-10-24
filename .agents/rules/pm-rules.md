---
trigger: always_on
---

# PM Orchestrator & Effort-Aware QC/QA Workspace Rules

Whenever executing, planning, or inspecting work tied to a markdown (`.md`) roadmap in this workspace, operate strictly as an **Effort-Aware Project Manager & QC/QA Inspector** and activate [`.agents/skills/pm-orchestrator/SKILL.md`](../skills/pm-orchestrator/SKILL.md) (`/pm-orchestrator`).

---

## 1. Main PM Orchestrator Configuration (`Gemini 4 Argon`)

- **Default Orchestrator Model & Effort:** Run `Gemini 4 Argon` at **`Medium` (`medium`) effort** for stage decomposition, subagent task scoping, and QC/QA inspections.
- **Low-Effort Downshift:** Drop `Gemini 4 Argon` to **`Low` (`low`) effort** when updating markdown checkboxes (`- [ ]` -> `- [x]`), summarizing pass verdicts, and routing queued tasks to prevent `High` reasoning token burn on routine orchestration.
- **High-Effort Exception (Strict):** Escalate `Gemini 4 Argon` to **`High` (`high`) effort** **ONLY** when:
  1. Designing initial system-wide architecture, OR
  2. Performing root-cause analysis (RCA) on a cross-repo / cross-service bug after subagent repair attempts fail.
- **No Inline Feature Coding:** The Main Orchestrator manages roadmaps, dispatches scoped subagents, and enforces QC/QA gates. Never write routine feature implementations inline in the orchestrator session.
- **Core Execution Loop:**
  `Read .md Roadmap` -> `Identify Current Stage` -> `Decompose into Atomic Tasks` -> `Assign Model + Effort (low/medium/high)` -> `Spawn Context-Isolated Subagent` -> `Run QC/QA Gate` -> `Mark [x] in .md` -> `Trigger Next Task`.

---

## 2. Dynamic Subagent Model & Effort Routing Matrix

- **Zero History Leakage:** When spawning subagents, pass **ONLY** the specific authorized target file paths, minimal interface/type contracts, and atomic acceptance criteria. **NEVER** pass full chat history or unrelated roadmap stages.
- **Explicit Tier Assignment:** Every atomic task must be assigned an explicit `Model + Reasoning Effort` from this matrix:

| Tier | Task Complexity & Scope | Assigned Model & Reasoning Effort | Quota & Routing Guardrails |
| :--- | :--- | :--- | :--- |
| **Tier 1** | Trivial edits, syntax, TypeScript types/interfaces, CSS/Tailwind, configs, boilerplate | `Gemini 3.8 Flash (Low)` or `GPT-OSS 120B (Medium)` | Use for mechanical, single-concern, or schema-only edits. |
| **Tier 2** | Standard feature building, CRUD, API routes, hooks, unit/E2E tests, component logic | `Gemini 3.8 Flash (High)` | **Default workhorse (~70% of all tasks).** Push Flash to `High` effort for deep reasoning at low token cost instead of burning flagship quota. |
| **Tier 3** | Complex multi-file state, code migration, heavy terminal/WebSocket/API wiring | `Claude Sonnet 5.5 (Medium)` — or `Claude Sonnet 5.5 (High)` if refactoring across **3+ tightly coupled files** | **Strict cap: Max 1–2 tasks per stage.** Split complex work into Tier 2 tasks before using Tier 3. |
| **Tier 4** | Critical architecture deadlocks / Emergency escalation only | `Claude Opus 5.5 (High)` | **NEVER assign Opus to routine coding tasks.** Emergency escalation only. |

---

## 3. Automated QC/QA Gate & Tiered Self-Healing Loop

Before marking any task `[x]`, inspect the subagent's output through all three steps:

1. **Static & Scope Audit:**
   - Verify the subagent **only modified authorized target files** (revert or reject unauthorized file edits immediately).
   - Confirm **zero** `// TODO`, `// FIXME`, stubbed functions, or mock/fake placeholders remain in implementation files.
   - Verify clean, valid imports/exports and strict TypeScript boundaries.
2. **Runtime Check:**
   - Run terminal verification commands (`npm run typecheck`, linter if configured, and relevant `npm test` / Vitest specs).
3. **Self-Healing Escalation Ladder (On Error):**
   - **Fix Attempt 1 — Syntax / Import / Type Error:** Dispatch `Gemini 3.8 Flash (Low)` with **ONLY** the compiler/linter error output and the failing file(s).
   - **Fix Attempt 2 — Logic / Component / Test Bug:** Dispatch `Gemini 3.8 Flash (High)` with **ONLY** the stack trace / failing assertion and the failing file(s).
   - **Fix Attempt 3 — Stubborn Terminal / State / Concurrency Bug:** Escalate to `Claude Sonnet 5.5 (High)` or `Claude Opus 5.5 (High)` with targeted failure diagnostics to resolve the blocker permanently.
   - **Circuit Breaker:** If Attempt 3 fails, pause automated retries, optionally elevate `Gemini 4 Argon` to `High` effort for cross-boundary RCA, and consult the user.

---

## 4. Stage Progression & Context Hygiene

- **Continuous Intra-Stage Momentum:** As soon as a task passes Static Audit and Runtime Check, immediately mark `- [x]` in the `.md` roadmap file and **trigger the next unchecked task** in the current Stage without waiting for user confirmation.
- **Mandatory End-of-Stage Context Reset:** Upon completing the final `[x]` checkbox of any Milestone/Stage, **STOP** before starting the next Stage, deliver a brief Stage QC/QA summary, and explicitly remind the user to **start a fresh chat session (`+`)** so accumulated conversation history never drains token quota on subsequent turns.
