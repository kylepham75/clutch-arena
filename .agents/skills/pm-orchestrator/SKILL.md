---
name: pm-orchestrator
description: >-
  Effort-aware Project Manager and automated QC/QA orchestrator for markdown (.md)
  roadmaps on Google Antigravity. Use when loading a project roadmap, decomposing
  stages into atomic tasks, dynamically routing workers across Gemini 4
  (Hydrogen/Argon/Orchestrator) and Claude 5.5 (Sonnet/Opus) by Model and
  Reasoning Effort (low, medium, high, xhigh), balancing quota pools, running
  static and runtime QC/QA inspections, executing tiered self-healing repairs,
  or updating roadmap stage checkboxes.
---

# PM Orchestrator & Effort-Aware QC/QA Skill

This skill turns the main agent into a quota-disciplined **Project Manager & QC/QA Inspector** that drives markdown (`.md`) roadmaps stage-by-stage on Google Antigravity by routing **Model selection, Reasoning Effort (`low`, `medium`, `high`, `xhigh`), and Quota Pools** using Antigravity's real execution primitives (`swarm` and `invoke_subagent`).

---

## 1. Main Orchestrator Model & Effort Governance

Do **not** burn scarce weekly frontier quota (`Gemini 4 Argon` / `Claude Opus 5.5`) on mechanical roadmap routing, checkbox ticking, or test-command orchestration. Match the orchestrator model and thinking level to the active phase:

| Orchestrator Phase | Recommended Model | Effort | Why & Token Guardrail |
| :--- | :--- | :-: | :--- |
| **Routine Stage Execution & QC/QA** *(default)* | **`Gemini 4 Hydrogen`** | **`Medium`** *(or `Low` for `[x]` updates)* | 2.5× faster than 3.8 Flash, >5× lower hallucination, parallel tool-calling optimized, 1M unified context, uses fast-resetting rolling quota pool. |
| **Initial Architecture / Complex Stage 0 Decomposition** | **`Orchestrator (Argon)`** or **`Gemini 4 Argon`** | **`Medium`** | `Orchestrator (Argon)` (`gemini-pro-orchestrator-g1-pro`) pairs Argon planning with Hydrogen execution (~24% less quota, ~19% faster than monolithic Argon). |
| **Cross-Repo / Multi-Service RCA** *(after Fix Attempt 3 fails)* | **`Gemini 4 Argon`** | **`High`** | **Strict exception only.** Downshift back to `Gemini 4 Hydrogen (Medium)` once RCA concludes. |

> [!TIP]
> **Session Pre-Flight Check:**
> - If the active chat session is set to `Gemini 4 Argon (High)` or `Claude Opus 5.5 (High)` during routine roadmap execution, add a one-line intake note recommending switching to **`Gemini 4 Hydrogen (Medium)`** (or **`Orchestrator (Argon)`** for heavy architectural stages) to preserve weekly/flagship quota.
> - If the active session is **`Gemini 4 Hydrogen (High)`**, it is safe for Stage execution (especially if using `invoke_subagent` with `Model: "inherit"`), though `Hydrogen (Medium)` is sufficient when dispatching workers via `swarm`.

---

## 2. Antigravity Model Roster, Quota Pools & Legacy Remapping

### Active Antigravity Models & Independent Quota Pools

Check live availability and percentages at Stage start via `swarm{action:"models", all:true}` when using Swarm mode:

| Quota Pool | Model Family & Exact `swarm` IDs | Verified Capabilities & Role |
| :--- | :--- | :--- |
| **Pool A: Gemini Fast Rolling** *(short-window reset)* | **`Gemini 4 Hydrogen`**<br>`gemini-4-hydrogen-low`<br>`gemini-4-hydrogen-medium`<br>`gemini-4-hydrogen-high`<br>`gemini-4-hydrogen-xhigh`<br><br>*Legacy:* `gemini-3.8-flash-*` | **Primary coding workhorse.** ~57% Terminal-Bench 4.1 (3× better than 3.8 Flash's ~18.2%), 2.5× faster, >5× fewer fabricated code claims, 1M unified context.<br>• `low`: mechanical `[x]` updates / Fix Attempt 1 syntax fixes.<br>• `medium`: Tier 1 edits, clean single-file logic & orchestration.<br>• `high`: Tier 2 default engineering & test suites (51 AA index).<br>• `xhigh`: Tier 2+ deep reasoning (54 AA index, surpasses default Argon, ~77.6% multi-turn coding; more verbose/slower — reserve for hard logic/repairs). |
| **Pool B: Gemini Frontier** *(longer/weekly reset)* | **`Gemini 4 Argon`**<br>`gemini-4-argon-low` / `-medium` / `-high`<br>**`Orchestrator (Argon)`**<br>`gemini-pro-orchestrator-g1-pro` | **Deep architecture & spatial/complex planning.** Strongest Google 1M-context planner; elite spatial/3D/math reasoning (87% ERQA). Preserve Pool B for initial architecture, Stage 0 planning, and cross-service RCA. |
| **Pool C: Anthropic** *(independent reset)* | **`Claude Sonnet 5.5`** (`claude-sonnet-5-5-low` / `-medium` / `-high`)<br>**`Claude Opus 5.5`** (`claude-opus-5-5-low` / `-medium` / `-high`) | **High-polish refactors, strict prompt adherence, & cross-pool failover.**<br>• `Sonnet 5.5`: strict multi-file adherence, polished production refactors, and **Pool A failover** when Hydrogen quota dips.<br>• `Opus 5.5 (High)`: ceiling (~84–89% multi-turn agentic coding) for critical architecture deadlocks & Fix Attempt 3+ emergencies. |
| **Deprecated / Unavailable** | `gpt-oss-120b-medium` *(Notice: sunset Nov 18, 2026)*<br>`Gemini 4 Carbon` *(Unavailable)*<br>`gemini-3.8-flash-*` *(Superseded)* | **Do not assign.** `3.8 Flash` shares Pool A with `Hydrogen` at ~3× lower Terminal-Bench accuracy; `GPT-OSS 120B` is sunsetting; `Carbon` is unavailable on standard selectors. |

### Automatic Legacy Roadmap Remapping
When executing older `.md` roadmaps that still specify legacy profiles, **auto-upgrade them on the fly** without requiring manual roadmap edits:
- `GPT-OSS 120B (Medium)` or `Gemini 3.8 Flash (Low)` / `(Medium)` → **`Gemini 4 Hydrogen (Medium)`** (`gemini-4-hydrogen-medium`)
- `Gemini 3.8 Flash (High)` → **`Gemini 4 Hydrogen (High)`** (`gemini-4-hydrogen-high`)
- `Gemini 4 Carbon` *(if unavailable)* → **`Gemini 4 Argon (High)`** or **`Claude Opus 5.5 (High)`**

---

## 3. Dynamic 5-Tier Subagent Routing Matrix

Assign every atomic task an explicit **Tier + Model + Effort** before dispatch:

| Tier | Workload Category | Target Share | Primary Model + Effort | Pool-Failover / Alternative | Qualifying Task Examples |
| :-: | :--- | :-: | :--- | :--- | :--- |
| **T1** | Trivial Edits, Syntax, Types, CSS, Configs | ~15–20% | `Gemini 4 Hydrogen (Medium)` | `Claude Sonnet 5.5 (Low)` *(if Pool A < 20%)* | TypeScript interfaces, simple Zod schemas, Tailwind/CSS polish, barrel exports, constants, copy edits, config tweaks. |
| **T2** | Standard Features, CRUD, API Routes, Tests | **~60–70%** | **`Gemini 4 Hydrogen (High)`** *(default)* | `Claude Sonnet 5.5 (Medium)` *(if Pool A < 20%)* | React/Next.js components, hooks, API route handlers, DB queries, Vitest unit/integration tests, Playwright E2E specs. |
| **T2+** | Deep Logic, Algorithms, Tough Single/Dual-File Bugs | ~10–15% | **`Gemini 4 Hydrogen (XHigh)`** | `Claude Sonnet 5.5 (High)` | Complex state machines, solver/math modules, intricate edge-case logic, stubborn component/test bugs (avoids burning Pool B/C unless needed). |
| **T3** | Coupled Multi-File Refactors (3+ files), Strict Spec Polish | **Max 1–2 / stage** | **`Claude Sonnet 5.5 (Medium/High)`** or **`Gemini 4 Argon (Medium)`** | `Gemini 4 Hydrogen (XHigh)` *(for non-architectural multi-file work)* | Cross-module auth/DB migrations, PartyKit/WebSocket engines, streaming AI SDK pipelines, 1M-context repo-wide refactors (`Argon`), or high-polish coupled edits (`Sonnet 5.5`). |
| **T4** | Critical Architecture / Emergency Escalation | **0% routine** | **`Claude Opus 5.5 (High)`** | `Gemini 4 Argon (High)` *(for spatial/large-context RCA)* | **Never assign to planned roadmap tasks.** Reserved strictly for Fix Attempt 3 deadlocks or architectural emergencies. |

### Quota & Isolation Rules
1. **Default to Pool A (`Hydrogen`):** Keep ~75–85% of Stage tasks on `Gemini 4 Hydrogen` (`Medium` / `High` / `XHigh`) before touching Pool B (`Argon`) or Pool C (`Sonnet`/`Opus`).
2. **Quota-Pool Balancing:** If `swarm{action:"models"}` shows Pool A (`Hydrogen`) below **20%**, shift T2/T2+ tasks to **Pool C (`Claude Sonnet 5.5 Low/Medium`)** instead of stalling or draining Pool B (`Argon`).
3. **Tier-3 Ceiling:** Never schedule more than **2 Tier-3 tasks** in one Stage. Split shared contracts/types into a T1 prerequisite and isolate leaf components into T2 tasks.
4. **Zero History Leakage:** Workers receive **ONLY**:
   - Assigned `Model + Effort` profile
   - Explicit **Authorized Write Files**
   - Minimal **Read-Only Reference Files** (directly imported types/schemas)
   - Atomic objective & acceptance criteria
   - **NEVER** pass prior chat history, unrelated stages, or full repo summaries.

---

## 4. Execution Primitive Selection: `swarm` vs `invoke_subagent`

Choose the dispatch tool that actually enforces the planned model/effort tier:

### Mode A: `swarm` Mode *(Recommended for multi-tier routing, `xhigh` / `Sonnet` / `Opus` pinning, or parallel tasks)*
`swarm` supports **exact per-worker `model` pinning** (`gemini-4-hydrogen-high`, `gemini-4-hydrogen-xhigh`, `claude-sonnet-5-5-high`, `claude-opus-5-5-high`, etc.), live quota checks, and model switching on quota exhaustion:
1. Run `swarm{action:"models", all:true}` once at Stage start to verify live quota pools.
2. Spawn workers with `swarm{action:"add", name:"<role>", model:"<exact-model-id>", brief:"..."}`:
   - For **sequential** tasks on the working tree, keep default `workspace:"inherit"`.
   - For **parallel** non-overlapping tasks, pass `workspace:"share"` (one worker per disjoint file set; never two authors in the same file) and instruct each worker to commit or report its branch so you merge cleanly before `kill`ing.
   - Optionally spawn a lightweight `verifier` worker (`gemini-4-hydrogen-medium` on `workspace:"inherit"`) for independent diff/test review on large stages.
3. **Quota Recovery Without Context Loss:** If a worker hits low quota or fails on quota, call `swarm{action:"model", name:"<worker>", model:"<healthy-pool-model>"}` (e.g., `claude-sonnet-5-5-medium`) rather than killing and re-adding it.
4. **Stay Lean:** `kill` finished workers once their work is landed and verified (remember `kill` deletes `share`/`branch` workspaces, so land changes first!).

### Mode B: `invoke_subagent` Mode *(Lightweight fallback for single sequential tasks)*
> [!IMPORTANT]
> **`invoke_subagent` Tool Constraint:** `invoke_subagent` only accepts `Model: "inherit" | "flash_lite" | "flash" | "pro"` — it **cannot** pin exact model strings or `xhigh` thinking levels via prompt text.
- If using `invoke_subagent` (with `define_subagent` having `EnableWriteTools: true`):
  - **Session on `Gemini 4 Hydrogen (Medium/High)`:** Pass `Model: "inherit"` for T1/T2 tasks; switch to `swarm` for T2+ (`xhigh`), T3 (`Sonnet 5.5` / `Argon`), or T4 (`Opus 5.5`).
  - **Session on `Gemini 4 Argon` / `Orchestrator (Argon)`:** Pass `Model: "flash"` or `"flash_lite"` for T1/T2 tasks, `Model: "pro"` for T3, or use `swarm` whenever exact model/effort pinning matters.

---

## 5. End-to-End Stage Execution Workflow

### Step 1: Load Roadmap & Lock Current Stage (`Hydrogen` — `Medium`)
1. Read the user-specified `.md` roadmap file.
2. Locate the active Stage/Milestone (the requested Stage or the first Stage containing unchecked `- [ ]` items).
3. Perform lightweight path discovery (`Get-ChildItem` or targeted header reads) to map bullets to exact workspace paths without loading whole files into orchestrator memory.
4. If dispatching via `swarm`, run `swarm{action:"models", all:true}` to confirm healthy quota pools.

### Step 2: Publish Atomic Task & Effort Plan (`Hydrogen` — `Medium`)
Decompose the Stage into sequential (or disjoint parallel) atomic tasks and print the routing table before dispatching Task 1:

```markdown
### Stage [N]: [Stage Name] — Execution & Effort Routing Plan
| # | Roadmap Target | Authorized Write Files | Tier | Model | Effort | Dispatch |
| :- | :--- | :--- | :-: | :--- | :-: | :-: |
| 1 | [Atomic task summary] | `path/to/types.ts` | T1 | `Gemini 4 Hydrogen` | `medium` | `swarm` / `subagent` |
| 2 | [Atomic task summary] | `path/to/Component.tsx`, `path/to/Component.test.tsx` | T2 | `Gemini 4 Hydrogen` | `high` | `swarm` |
| 3 | [Atomic task summary] | `path/to/solver.ts` | T2+ | `Gemini 4 Hydrogen` | `xhigh` | `swarm` |
| 4 | [Atomic task summary] | `path/to/store.ts`, `path/to/sync.ts`, `path/to/hook.ts` | T3 | `Claude Sonnet 5.5` | `high` | `swarm` |
```

### Step 3: Dispatch Context-Isolated Worker (`Hydrogen` — `Low`)
Send this minimal-context payload via `swarm{action:"add", ...}` (or `invoke_subagent`):

```markdown
## Worker Task Dispatch
- **Target Profile:** [Exact Model ID, e.g. `gemini-4-hydrogen-high`] (Tier [T1|T2|T2+|T3|T4])
- **Authorized Write Files (STRICT SCOPE):**
  - `[exact/path/file1.ts]`
- **Read-Only Context Files (Inspect ONLY these):**
  - `[exact/path/types.ts]`
- **Atomic Objective:**
  [Concise, concrete specification of what to implement]
- **Acceptance Criteria & Constraints:**
  1. Touch ONLY the Authorized Write Files above. Do not edit roadmap `.md` files or unrelated modules.
  2. Leave ZERO `// TODO`, `// FIXME`, mock data, or placeholder stubs.
  3. Flag any missing context or blocked dependency instead of guessing or fabricating APIs.
  4. Ensure all imports/exports and TypeScript types are complete and valid.
  5. Return a brief summary of changed symbols when done; do NOT run full-repo builds unless instructed.
```

### Step 4: Automated QC/QA Inspector Gate (`Hydrogen` — `Medium`)
Immediately after each worker completes, run **both** verification phases before touching the `.md` checkbox:

#### 4A. Static & Scope Audit
1. **Scope Verification:** Run `git status --short` (and `git diff --name-only` when needed) to verify **only** Authorized Write Files were created or modified. Revert unauthorized edits immediately (`git checkout -- <unauthorized-file>`) and flag a scope violation.
2. **Zero-Placeholder Scan:** Inspect modified sections (or run PowerShell `Select-String -Path <authorized-files> -Pattern "TODO|FIXME|HACK|not implemented|mockData"`) to verify zero stubs or fake placeholders remain.
3. **Import/Export Integrity:** Confirm new exports match consumer imports, path aliases (`@/...`) match `tsconfig.json`, and zero broken imports were introduced.

#### 4B. Runtime Check
Run the workspace's fast terminal verification commands (check `package.json` scripts on first run):
- **Typecheck:** `npm run typecheck` (or `npx tsc --noEmit`)
- **Linter (if configured):** `npm run lint`
- **Targeted Tests:** `npx vitest run <related-test-path>` (or `npm test` for shared core utilities)

### Step 5: Tiered Self-Healing Escalation Ladder (When Step 4 Fails)
Never patch feature code manually in the orchestrator and never resend full chat history. Escalate cleanly across effort tiers and model families:

| Repair Step | Failure Class | Dispatched Model (`swarm` ID) | Strict Payload Sent to Repair Worker |
| :-: | :--- | :--- | :--- |
| **Fix Attempt 1** | Syntax error, missing import/export, or TypeScript type mismatch | **`Gemini 4 Hydrogen (Low)`**<br>(`gemini-4-hydrogen-low`) | **ONLY** the exact compiler/linter error lines + failing file path(s). |
| **Fix Attempt 2** | Component bug, runtime exception, failed test assertion, or failed Attempt 1 | **`Gemini 4 Hydrogen (High)`** *(or **`XHigh`** `gemini-4-hydrogen-xhigh` for complex logic)* | **ONLY** the stack trace / failing test assertion + failing file(s) and tested module path. |
| **Fix Attempt 3** | Stubborn terminal failure, multi-file state/concurrency bug, or failed Attempt 2 *(cross-family escalation)* | **`Claude Sonnet 5.5 (High)`** (`claude-sonnet-5-5-high`) or **`Claude Opus 5.5 (High)`** (`claude-opus-5-5-high`) | **ONLY** the exact failure output, 2-bullet summary of why Attempts 1–2 failed, and coupled file paths. *(Switching to Anthropic breaks Gemini-family blind spots).* |

**Repair Loop Rules:**
- Re-run **Step 4 (Static Audit + Runtime Check)** after every Fix Attempt.
- **Circuit Breaker:** If **Fix Attempt 3** still fails, **STOP** automated retries. For cross-service root-cause bugs, escalate to `Gemini 4 Argon (High)` / `Orchestrator (Argon)` for RCA, present a crisp diagnostic report, and ask the user how to proceed.

### Step 6: Roadmap Checkbox Update & Auto-Progression (`Hydrogen` — `Low`)
As soon as Step 4 passes (`0` static violations, `0` runtime/type errors):
1. Use `edit_file` to mark the corresponding item(s) `- [x]` in the `.md` roadmap file.
2. Output a single-line pass log (e.g., `✅ Task 2 passed QC/QA [Gemini 4 Hydrogen (High) | Repairs: 0] — Roadmap updated.`).
3. **Immediately dispatch the next unchecked task** in the current Stage (looping back to Step 3) without waiting for user confirmation.

### Step 7: Stage Completion & Context Hygiene Gate (`Hydrogen` — `Low`)
When **all** checkboxes in the current Milestone/Stage are marked `[x]`:
1. Clean up any finished `swarm` workers (`kill` only after confirming all changes are merged/landed).
2. Run one final stage-level sanity check (`npm run typecheck` + stage test suite) if multiple tasks interacted.
3. **STOP execution immediately** — never auto-start the next Stage in the same session.
4. Present the **Stage Sign-Off & Context Reset Prompt**:

```markdown
## Stage [N] Complete: [Stage Name]
- **Roadmap Checkboxes Updated:** `[X/X]` marked `[x]` in `[roadmap-file.md]`
- **Routing Breakdown:** T1 (`Hydrogen Med`): `[n]` | T2 (`Hydrogen High`): `[n]` | T2+ (`Hydrogen XHigh`): `[n]` | T3 (`Sonnet/Argon`): `[n]` | T4 (`Opus`): `[n]`
- **QC/QA & Self-Healing:** `[n]` passed first-try, `[n]` self-healed via repair loop.

> [!IMPORTANT]
> **Context Hygiene — Start a Fresh Chat (`+`) Before Stage [N+1]**
> To prevent accumulated chat history from draining your token quota on subsequent turns, please open a **new chat session (`+`)** now and prompt:
> *"Load `[roadmap-file.md]` and execute Stage [N+1] with `/pm-orchestrator`."*
```
