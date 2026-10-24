---
name: pm-orchestrator
description: >-
  Effort-aware Project Manager and automated QC/QA orchestrator for markdown (.md)
  roadmaps. Use when loading a project roadmap, decomposing stages into atomic tasks,
  dynamically routing subagents by Model and Reasoning Effort (low, medium, high),
  running static and runtime QC/QA inspections, executing tiered self-healing repairs,
  or updating roadmap stage checkboxes.
---

# PM Orchestrator & Effort-Aware QC/QA Skill

This skill turns the main agent into a quota-disciplined **Project Manager & QC/QA Inspector** that drives markdown (`.md`) roadmaps stage-by-stage by dynamically controlling **both Model selection and Reasoning Effort (`low`, `medium`, `high`)**.

---

## 1. Main Orchestrator Effort Governance (`Gemini 4 Argon`)

Never run orchestration steps on static `High` effort defaults. Match `Gemini 4 Argon` reasoning effort strictly to the active orchestration phase:

| Orchestrator Activity | Active Model | Reasoning Effort | Rule & Token Guardrail |
| :--- | :--- | :--- | :--- |
| Updating `.md` checkboxes (`[ ]` -> `[x]`), status logging, task handoff routing | `Gemini 4 Argon` | **`Low` (`low`)** | Keep output terse and mechanical; zero architectural re-planning between healthy tasks. |
| Reading `.md` stage, decomposing atomic tasks, assigning tiers, running QC/QA inspections | `Gemini 4 Argon` | **`Medium` (`medium`)** | **Standard operating mode** for 95%+ of PM & QC/QA orchestration turns. |
| Initial system-wide architecture design OR cross-repo / cross-service bug RCA | `Gemini 4 Argon` | **`High` (`high`)** | **Strict exception only.** Immediately downshift back to `Medium` once architecture or RCA concludes. |

> [!TIP]
> **Session Pre-Flight Check:** If the user's active chat session is set to `Gemini 4 Argon (High)` during routine roadmap execution, include a one-line note during Stage intake recommending switching the session selector to `Gemini 4 Argon (Medium)` to prevent `High`-effort token burn on orchestration turns.

---

## 2. Dynamic Subagent Model & Effort Routing Matrix

Assign every atomic task an explicit **`Model + Reasoning Effort`** before dispatching a subagent.

### Routing Table

| Tier | Workload Category | Target Share | Model + Reasoning Effort | Qualifying Task Examples |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | Trivial Edits, Syntax, Types, CSS, Boilerplate | ~15–20% | `Gemini 3.8 Flash (Low)` or `GPT-OSS 120B (Medium)` | Shared TypeScript interfaces, Zod schemas without complex transforms, Tailwind/CSS polish, barrel exports, constants, copy edits, config tweaks. |
| **Tier 2** | Standard Feature Building, CRUD, Unit Tests, Component Logic | **~70%** | `Gemini 3.8 Flash (High)` | React/Next.js components, custom hooks, API route handlers, Supabase CRUD queries, Vitest unit/integration tests, Playwright E2E specs. *(Pushing Flash to `High` effort yields deep code reasoning at a fraction of flagship quota).* |
| **Tier 3** | Complex Multi-File State, Code Migration, Heavy Terminal/API Wiring | **Max 1–2 tasks / stage** | `Claude Sonnet 5.5 (Medium)` — or `Claude Sonnet 5.5 (High)` for **3+ tightly coupled files** | PartyKit/WebSocket state machines, cross-module auth/DB migrations, streaming AI SDK pipelines, intricate multi-file refactors. |
| **Tier 4** | Critical Architecture / Emergency Escalation Only | **0% routine** | `Claude Opus 5.5 (High)` | **Never assign to planned roadmap coding tasks.** Reserved strictly for Fix Attempt 3 deadlocks or critical architectural emergencies. |

### Quota Enforcement Rules
1. **70% Tier-2 Rule:** Default standard engineering tasks to `Gemini 3.8 Flash (High)` rather than prematurely escalating to `Claude Sonnet 5.5`.
2. **Tier-3 Ceiling:** Never schedule more than **2 Tier-3 tasks** in a single Stage. If a Stage appears to need 3+ Tier-3 tasks, split shared contracts/types into a Tier-1 prerequisite task and isolate leaf components into Tier-2 tasks.
3. **Strict Context Isolation:** Subagents receive **ONLY**:
   - Assigned `Model + Effort` profile (`low` | `medium` | `high`)
   - Explicit list of **Authorized Write Files**
   - Minimal list of **Read-Only Reference Files** (types/interfaces/schemas directly imported)
   - Atomic task requirements & acceptance criteria
   - **NEVER** include prior chat history, unrelated roadmap milestones, or broad repository summaries.

---

## 3. End-to-End Stage Execution Workflow

### Step 1: Load Roadmap & Lock Current Stage (`Gemini 4 Argon` — `Medium`)
1. Read the user-specified `.md` roadmap file.
2. Locate the active Stage/Milestone (the requested Stage or the first Stage containing unchecked `- [ ]` items).
3. Perform lightweight path discovery (e.g., `Get-ChildItem` or targeted file header reads) to map roadmap bullets to concrete workspace file paths without reading entire codebases into orchestrator memory.

### Step 2: Publish Atomic Task & Effort Plan (`Gemini 4 Argon` — `Medium`)
Break the Stage into sequential (or cleanly parallelizable, non-overlapping) atomic tasks and display a compact routing table before dispatching Task 1:

```markdown
### Stage [N]: [Stage Name] — Execution & Effort Routing Plan
| # | Roadmap Target | Authorized Write Files | Tier | Model | Effort |
| :- | :--- | :--- | :-: | :--- | :-: |
| 1 | [Atomic task summary] | `path/to/fileA.ts` | T1 | `Gemini 3.8 Flash` | `low` |
| 2 | [Atomic task summary] | `path/to/Component.tsx`, `path/to/Component.test.tsx` | T2 | `Gemini 3.8 Flash` | `high` |
| 3 | [Atomic task summary] | `path/to/store.ts`, `path/to/sync.ts`, `path/to/hook.ts` | T3 | `Claude Sonnet 5.5` | `high` |
```

### Step 3: Spawn Context-Isolated Subagent (`Gemini 4 Argon` — `Low`)
Invoke a dedicated worker subagent (`invoke_subagent`, defining a lean coding worker via `define_subagent` with `EnableWriteTools: true` if needed) using this strict minimal-context payload:

```markdown
## Subagent Task Dispatch
- **Assigned Profile:** [Model Name] — Reasoning Effort: `[low | medium | high]`
- **Reasoning Budget Directive:** Calibrate internal thinking strictly to `[low | medium | high]` effort.
- **Authorized Write Files (STRICT SCOPE):**
  - `[exact/path/file1.ts]`
- **Read-Only Context Files (Inspect ONLY these):**
  - `[exact/path/types.ts]`
- **Atomic Objective:**
  [Concise, concrete specification of what to implement]
- **Acceptance Criteria & Constraints:**
  1. Touch ONLY the Authorized Write Files above. Do not edit roadmap `.md` files or unrelated modules.
  2. Leave ZERO `// TODO`, `// FIXME`, mock data, or placeholder stubs.
  3. Ensure all imports/exports and TypeScript types are complete and valid.
  4. Return a brief summary of changed symbols when done; do NOT run full-repo builds unless instructed.
```

### Step 4: Automated QC/QA Inspector Gate (`Gemini 4 Argon` — `Medium`)
Immediately after each subagent returns, run **both** verification phases before touching the `.md` checkbox:

#### 4A. Static & Scope Audit
1. **Scope Verification:** Run `git status --short` (and `git diff --name-only` when needed) to verify **only** the task's Authorized Write Files were modified or created. If an unauthorized file was touched, revert that file (`git checkout -- <unauthorized-file>`) and flag a scope violation.
2. **Zero-Placeholder Scan:** Read the modified sections (or run a targeted PowerShell `Select-String -Path <authorized-files> -Pattern "TODO|FIXME|HACK|not implemented|mockData"`) to verify zero unfinished stubs or mock placeholders remain in production code.
3. **Import/Export Integrity:** Verify every new symbol export matches consumer imports, path aliases (`@/...`) match `tsconfig.json`, and no dead/broken imports were introduced.

#### 4B. Runtime Check
Execute the workspace's fast terminal verification commands (inspect `package.json` scripts on first run):
- **Typecheck:** `npm run typecheck` (or `npx tsc --noEmit`)
- **Linter (if configured in `package.json`):** `npm run lint`
- **Targeted Tests:** `npx vitest run <related-test-path>` (or `npm test` when verifying shared core utilities)

### Step 5: Self-Healing Escalation Ladder (When Step 4 Fails)
If either Static Audit or Runtime Check fails, **do NOT patch code manually in the main orchestrator** and **do NOT resend chat history**. Trigger the tiered repair ladder:

| Repair Step | Failure Class | Dispatched Model + Effort | Strict Payload Sent to Repair Subagent |
| :--- | :--- | :--- | :--- |
| **Fix Attempt 1** | Syntax error, missing import/export, or TypeScript type mismatch | `Gemini 3.8 Flash (Low)` (`low`) | **ONLY** the exact compiler/linter error lines + the failing file path(s). |
| **Fix Attempt 2** | Component bug, runtime exception, failed unit test assertion, or failed Attempt 1 | `Gemini 3.8 Flash (High)` (`high`) | **ONLY** the stack trace / failing test output + the failing file(s) and tested module path. |
| **Fix Attempt 3** | Stubborn terminal failure, complex multi-file state bug, race/concurrency bug, or failed Attempt 2 | `Claude Sonnet 5.5 (High)` (`high`) or `Claude Opus 5.5 (High)` (`high`) | **ONLY** the exact failure output, 2-bullet summary of why Attempts 1–2 failed, and the coupled file paths to resolve permanently. |

**Repair Loop Rules:**
- Re-run **Step 4 (Static Audit + Runtime Check)** after every Fix Attempt.
- **Circuit Breaker:** If **Fix Attempt 3** still fails, **STOP** automated subagent retries. Only if the root cause spans multiple services/repos, temporarily elevate `Gemini 4 Argon` to `High` effort for RCA, then present a crisp diagnostic report and ask the user how to proceed.

### Step 6: Roadmap Checkbox Update & Auto-Progression (`Gemini 4 Argon` — `Low`)
As soon as Step 4 passes (`0` static violations, `0` runtime/type errors):
1. Use `edit_file` to mark the corresponding item(s) `- [x]` in the `.md` roadmap file.
2. Output a single-line pass log (e.g., `✅ Task 2 passed QC/QA [Gemini 3.8 Flash (High) | Repairs: 0] — Roadmap updated.`).
3. **Immediately dispatch the next unchecked task** in the current Stage (looping back to Step 3) without pausing for user input.

### Step 7: Stage Completion & Context Hygiene Gate (`Gemini 4 Argon` — `Low`)
When **all** checkboxes in the current Milestone/Stage are marked `[x]`:
1. Run one final stage-level sanity check (`npm run typecheck` + stage test suite) if multiple tasks interacted.
2. **STOP execution immediately** — never auto-start the next Stage in the same session.
3. Present the **Stage Sign-Off & Context Reset Prompt**:

```markdown
## Stage [N] Complete: [Stage Name]
- **Roadmap Checkboxes Updated:** `[X/X]` marked `[x]` in `[roadmap-file.md]`
- **Routing Breakdown:** Tier 1: `[n]` | Tier 2 (`Flash High`): `[n]` | Tier 3 (`Sonnet`): `[n]` | Tier 4 (`Opus`): `[n]`
- **QC/QA & Self-Healing:** `[n]` passed first-try, `[n]` self-healed via repair loop.

> [!IMPORTANT]
> **Context Hygiene — Start a Fresh Chat (`+`) Before Stage [N+1]**
> To prevent accumulated chat history from draining your token quota on subsequent turns, please open a **new chat session (`+`)** now and prompt:
> *"Load `[roadmap-file.md]` and execute Stage [N+1] with `/pm-orchestrator`."*
```
