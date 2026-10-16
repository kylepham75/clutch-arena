# ClutchArena — Modules 1 & 2

A desktop-first solo active-recall game built with Next.js 15, React 19, TypeScript, Tailwind CSS, local shadcn-style primitives, Framer Motion, and Web Audio.

## Run locally

Requires Node.js 22.16 or later.

```sh
npm install
npm run dev
```

Open http://localhost:3000 (or /solo). No API keys or accounts are needed for this module.

## Implemented

- Five authored microeconomics questions, each with four options and a concept variant.
- Classic recall and concept-remix modes.
- Three lives; 15-second, deadline-based question timers; pause/resume.
- A–D or 1–4 to answer; Enter or Space to advance after feedback.
- 100 XP per correct answer; 150 XP from a three-answer streak; 200 XP from five. Seven triggers ON FIRE. A miss resets the multiplier.
- Correct answer highlighting, explanation, rule, and explicitly labeled demo study-note citation.
- Four-second reading pause on a miss or timeout. Missed concepts enter a spaced queue, alternating original and variant forms until two consecutive correct review attempts, or the run ends at zero lives.
- Web Audio feedback, mute preference, reduced-motion support, and completion confetti.
- Completed-run history saved locally, capped at 50 runs. Unfinished runs are not persisted.
- Responsive layouts, keyboard focus indicators, modal focus management, and outcome text in addition to colors.

## Key files

- `components/quiz/solo-engine.tsx`: integrates the playable screen.
- `lib/game/reducer.ts`: pure game state and guarded transitions.
- `lib/game/scoring.ts`: streak rewards.
- `lib/schemas/question.ts`: strict user-specified QuestionItem shape; tuple of exactly four options; required conceptVariant.
- `data/mock-microeconomics.ts`: five sample questions; source metadata is separate from the strict AI schema.
- `hooks/use-solo-game.ts`: timer lifecycle and reducer integration.
- `hooks/use-game-keyboard.ts`: keyboard controls with input/dialog/repeat guards.
- `hooks/use-game-audio.ts`: synthesized audio unlocked by a user gesture.

## Checks

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

The browser suite starts a development server automatically if port 3000 is free. It covers a full keyboard run, scoring, persistence, a timeout, feedback locking, pause/resume, concept mastery, variant mode, mobile overflow, and keyboard access to toolbar controls.

The dependency lockfile includes a patched PostCSS override for Next.js 15 and an updated Vitest test runner. Keep the lockfile committed when putting this project under version control.

## Document ingestion API (Module 2)

`POST /api/ingest` now parses PDF, DOCX, and UTF-8 TXT uploads. Preview mode runs without credentials. Generation uses Gemini via the AI SDK and validates the strict question schema, answer choices, and source excerpts. The returned study pack is compatible with the solo engine.

See [the API guide](docs/ingestion-api.md) for configuration, working PowerShell requests, response fields, limits, and error handling. Copy `.env.example` to `.env.local` and add your own Google API key to test live generation.

## Module boundary

The playable screen still uses the five sample questions. The upload UI and AI coach are Module 3; Supabase multiplayer is Module 4. Sidebar items marked Soon remain unavailable until those modules are confirmed. Only an explicit API generation request calls an external service.

The sample citations refer to illustrative demo notes, not uploaded files. Correct answers are available to the client for this local practice engine; multiplayer will require server-authoritative scoring.
