# 🌐 CLUTCH ARENA — Bilingual Localization (EN/VI) Architecture & PM Orchestrator Roadmap

> **Document Version:** 1.0.0  
> **Created:** October 29, 2026  
> **Orchestrator:** `/pm-orchestrator` (`Gemini 4 Argon` — Effort-Aware QC/QA)  
> **Objective:** Eliminate all hardcoded English/Vietnamese UI strings, decouple language selection from currency selection, and establish a 100% strictly divided, reactive bilingual (`en` | `vi`) experience across every page, modal, game engine, and study tool in Clutch Arena.

---

## 1. Root-Cause Audit: Why Language Switching Currently Breaks

A full-repository inspection of `lib/i18n/`, `app/`, and `components/` identified **6 systemic localization defects**:

1. **Language–Currency Conflation in `PricingModal` (`components/pricing/pricing-modal.tsx`):**
   - Line 78 defines `const isVi = language === "vi" || currency === "vnd";`, and `currency` initializes once at mount (`useState(() => language === "vi" ? "vnd" : "usd")`) without syncing when `language` changes.
   - **Consequence:** Switching the site language from `VI` to `EN` leaves `currency === "vnd"`, which forces `isVi === true`—keeping the entire Pricing Modal locked in Vietnamese! Conversely, inside the VND VietQR checkout block (lines 513–676), labels like `"Gói đăng ký"`, `"Ngân hàng:"`, `"Số tài khoản:"`, `"Kiểm tra trạng thái thanh toán"` are hardcoded in Vietnamese without checking `language`.
2. **Hardcoded Vietnamese Tier Names in `AuthDialog` (`components/auth/auth-dialog.tsx`):**
   - Lines 250–251 render `"Đấu Sĩ Pro (Học Kỳ)"` and `"Giảng Viên & Nhóm Học (Tutor)"` unconditionally inside an otherwise 100% hardcoded-English modal.
3. **14 Components & Pages Completely Disconnected from `useLanguage()`:**
   - **Multiplayer Arena Suite:** `arena-manager.tsx`, `arena-lobby.tsx`, `arena-game.tsx`, `arena-podium.tsx`, and `app/arena/page.tsx` do not import `useLanguage()`. Only `arena-entrance.tsx` is partially wired (and still has hardcoded English error messages, `"Host-Pays, Friends-Play-Free"` banner, and `"No Study Packs Found"`).
   - **Clutch Notes AI Suite:** `clutch-notes-panel.tsx`, `before-after-modal.tsx`, and `note-renderer.tsx` have zero `useLanguage()` integration (100% hardcoded English UI chrome combined with hardcoded Vietnamese `"Trong đó:"` in `FormulaBlock`).
   - **Study & Workspace Modals:** `flashcard-review.tsx`, `document-viewer.tsx`, `pack-share-dialog.tsx`, `tutorial-dialog.tsx`, `auth-dialog.tsx`, `user-profile-button.tsx`, `app/error.tsx`, and `app/loading.tsx` are 100% hardcoded English.
4. **Partial Localization Leaks in Already-Wired Components:**
   - **`solo-engine.tsx`:** Topbar lacks a tab for `notes` (`Clutch Notes AI`) and the topbar breadcrumb falls back to `t.headings.arenaTitle` when `activeTab === "notes"`. Empty-deck welcome card (`"Welcome to Clutch Arena"`, `"Interactive Tutorial"`, `"Load Example Deck"`), Comeback Sprint card (`"Comeback Sprint Ready"`, `"weak spots"`), In-Run sidebar (`"YOUR SESSION"`, `"One concept at a time."`, `"Take a breather"`, `"Leave run"`), Progress Dialog (`"Every session adds up."`, `"Runs History"`, `"Concept Mastery"`), Leave Dialog (`"Call it a practice round?"`), and Pause Dialog (`"Breathe. You've got time."`) are all hardcoded in English.
   - **`upload-panel.tsx`:** Progress step timers, error messages, tier badge (`"Contender: 2 uploads/wk"`), and Preview Result card (`"Preview Extracted:"`, `"Generate X Questions Now"`) are hardcoded in English.
   - **`coach-panel.tsx`:** Active focus banner (`"Focus: Missed question..."`, `"Focus: Post-run debrief..."`), streaming indicator (`"Coach is analyzing source material..."`), citation fallback labels (`"Doc X · Slide Y"`), and default debrief prompt strings sent to the AI Coach are hardcoded in English.
   - **`library-dialog.tsx`:** `"SAVED STUDY PACKS"`, `"Import JSON"`, `"No uploaded packs saved yet."`, `"Play"`, `"Arena"` are hardcoded in English despite `t.library` keys existing in `translations.ts`.
   - **`run-summary.tsx` & `feedback-card.tsx`:** `"1-Click PDF Cheat Sheet"`, `"This run is saved on this device..."`, and `"Keep that momentum." / "Queued for a fresh attempt."` are hardcoded in English.

---

## 2. Governing Localization Architecture Principles

1. **Strict Separation of `language` (UI Copy) vs. `currency` (Payment Method):**
   - `language` (`"en" | "vi"`) controls **100% of UI text, headings, badges, tooltips, and error messages**.
   - `currency` (`"vnd" | "usd"`) controls **ONLY** price figures (`5.000đ` vs. `$3.99`) and payment gateway view (PayOS VietQR vs. Global Card).
   - Flipping the `LanguageSwitcher` (`EN` ↔ `VI`) must immediately translate all visible text and sync the default currency (`vi` → `vnd`, `en` → `usd`) unless the user explicitly toggled currency inside an open checkout.
2. **Single Source of Truth in `lib/i18n/translations.ts`:**
   - All UI strings must live in strongly-typed sections of `TranslationDict` so TypeScript enforces 1:1 key parity between `translations.en` and `translations.vi`.
3. **Bilingual Parity Automated Gate (`tests/unit/i18n.test.ts`):**
   - Automated unit tests must recursively verify that every nested key in `translations.en` exists in `translations.vi`, is non-empty, and has no accidental English/Vietnamese cross-contamination.

---

## 3. Staged Execution Roadmap (`/pm-orchestrator`)

### Stage 1: Core i18n Schema Expansion & Solo Workspace Completion
*Scope: Expand `TranslationDict` with complete typed namespaces for all workspace modules, and eliminate every remaining hardcoded string in the Solo Engine, Quiz Cards, Flashcards, and Topbar/Sidebar.*

- [x] **Task 1.1 (Tier 2 — `Gemini 3.8 Flash` `high`):** Expand `lib/i18n/translations.ts` (`TranslationDict`, `translations.en`, `translations.vi`) with comprehensive, idiomatic English and Vietnamese keys covering:
  - Missing `topbar.notes` tab & tooltips (`hideDocViewer`, `showDocViewer`, `sendFeedback`, `viewPricing`)
  - `run` additions (welcome card, comeback sprint aside, in-run session sidebar, pause/leave dialogs, progress & mastery modal, feedback momentum footers, cheat sheet button, footnote)
  - `flashcard` namespace (header, shuffle/exit, progress, front/back labels, flip hints, verdicts, summary stats & actions)
  - `upload` additions (tier pill, dynamic progress steps, preview result card, validation errors)
  - `coach` additions (focus banner, localized explain/debrief auto-prompts, streaming indicator, error fallbacks, citation slide labels)
  - `library` & `share` namespaces (saved packs header, import JSON, export formats, scope toggles, zero-CAC callout, warnings)
  - `docViewer` namespace (empty state, pages/sections count, search input, no matches, ask coach, read more/show less)
  - `notes` namespace (Clutch Notes panel, dropzone, progress steps, sample button, Before/After modal, NoteRenderer toolbar, verification badges, textbook divergence card, `"Trong đó:"` / `"Where:"` variable header, uncaptured formulas box)
  - `arena` additions (Host-Pays banner, lobby roster, bot archetypes, match rules, countdown, live HUD, spectator/submitted banners, round feedback, leaderboard, podium, class analytics dashboard, gradebook CSV button, loading/error states, `/arena` header)
  - `auth`, `pricing`, `tutorial`, and `common` (error/loading pages) namespaces.
- [x] **Task 1.2 (Tier 2 — `Gemini 3.8 Flash` `high`):** Localize `components/quiz/solo-engine.tsx` to 100% EN/VI parity:
  - Add `Notes` tab to `.topbar-nav-tabs` and fix breadcrumb active tab title for `activeTab === "notes"`.
  - Replace all hardcoded strings in the Empty Study Pack welcome card, Comeback Sprint aside card, In-Run right sidebar (`YOUR SESSION`, `One concept at a time`, `Reinforcing`, `Looking good`, `Take a breather`, `Switch deck`, `Leave run`, keyboard footer), Progress & Concept Mastery dialog (`getMasteryLevel` labels, `Runs History`, `Concept Mastery`, empty states), Leave Run dialog, and Pause dialog.
- [x] **Task 1.3 (Tier 2 — `Gemini 3.8 Flash` `high`):** Localize `components/quiz/flashcard-review.tsx`, `components/quiz/run-summary.tsx`, `components/quiz/feedback-card.tsx`, `components/quiz/question-card.tsx`, `components/quiz/game-hud.tsx`, and `components/quiz/timer-bar.tsx`:
  - Wire `FlashcardReview` to `useLanguage()` (`t.flashcard.*`).
  - Localize `1-Click PDF Cheat Sheet` and device-save footnote in `RunSummary`, momentum status in `FeedbackCard`, and aria-labels across HUD/Question/Timer components.
- [x] **Task 1.4 (Tier 1 — `Gemini 3.8 Flash` `low`):** Expand `tests/unit/i18n.test.ts` to recursively validate deep key parity and non-empty string values across all new namespaces in `translations.en` and `translations.vi`.

---

### Stage 2: Workspace Panels, Dialogs, Auth & Pricing Localization
*Scope: Decouple language from currency in PricingModal, eliminate mixed-language bugs in AuthDialog, and localize UploadPanel, CoachPanel, DocumentViewer, LibraryDialog, PackShareDialog, TutorialDialog, and Error/Loading views.*

- [x] **Task 2.1 (Tier 2 — `Gemini 3.8 Flash` `high`):** Fix language/currency conflation in `components/pricing/pricing-modal.tsx` and localize `components/auth/auth-dialog.tsx` & `components/auth/user-profile-button.tsx`:
  - In `PricingModal`: Change `const isVi = language === "vi";` (strictly driven by `language`, never `currency === "vnd"`). Sync default `currency` when `language` flips (`useEffect(() => setCurrency(language === "vi" ? "vnd" : "usd"), [language])`). Localize all VietQR and USD checkout labels using `t.pricing.*` so English users viewing VND or Vietnamese users viewing USD see UI labels in their chosen language.
  - In `AuthDialog` & `UserProfileButton`: Wire `useLanguage()` (`t.auth.*`), fixing the hardcoded Vietnamese tier names (`Đấu Sĩ Pro` / `Giảng Viên`) when in English mode and translating all sign-in/sign-up/account labels when in Vietnamese mode.
- [x] **Task 2.2 (Tier 2 — `Gemini 3.8 Flash` `high`):** Localize `components/workspace/upload-panel.tsx` and `components/workspace/coach-panel.tsx`:
  - In `UploadPanel`: Localize tier quota pill, dynamic progress messages, file rejection/validation errors, and Preview Extracted card using `t.upload.*`.
  - In `CoachPanel`: Localize focus banner, auto-sent explain/debrief prompts (sending Vietnamese prompt when `language === "vi"` and English when `language === "en"`), streaming indicator, error fallback, and citation chip display (`Slide` / `Trang`).
- [x] **Task 2.3 (Tier 2 — `Gemini 3.8 Flash` `high`):** Localize `components/workspace/document-viewer.tsx`, `components/workspace/library-dialog.tsx`, and `components/workspace/pack-share-dialog.tsx`:
  - Wire `DocumentViewer` (`t.docViewer.*`), `LibraryDialog` (`t.library.*`), and `PackShareDialog` (`t.share.*`) to `useLanguage()`.
- [x] **Task 2.4 (Tier 2 — `Gemini 3.8 Flash` `high`):** Localize `components/tutorial/tutorial-dialog.tsx`, `app/error.tsx`, and `app/loading.tsx`:
  - Wire the 6-step `TutorialDialog` to `useLanguage()` (`t.tutorial.*`) and localize `app/error.tsx` and `app/loading.tsx`.

---

### Stage 3: Clutch Notes AI & Multiplayer Study Arena Localization
*Scope: Bring full EN/VI reactivity to the Clutch Notes AI suite (`ClutchNotesPanel`, `BeforeAfterModal`, `NoteRenderer`) and the entire Multiplayer Study Arena (`ArenaEntrance`, `ArenaManager`, `ArenaLobby`, `ArenaGame`, `ArenaPodium`, `app/arena/page.tsx`).*

- [x] **Task 3.1 (Tier 2 — `Gemini 3.8 Flash` `high`):** Localize `components/notes/clutch-notes-panel.tsx` and `components/notes/before-after-modal.tsx`:
  - Wire both components to `useLanguage()` (`t.notes.*`), translating all headers, feature badges, dropzone instructions, 5-stage synthesis progress messages, error alerts, and the Before/After comparison showcase.
- [x] **Task 3.2 (Tier 2 — `Gemini 3.8 Flash` `high`):** Localize `components/notes/note-renderer.tsx`:
  - Wire `NoteRenderer`, `SlideChip`, `ItemStatusChip`, `FormulaStatusBadge`, `TextbookDivergenceCard`, and `FormulaBlock` to `useLanguage()` (`t.notes.*`).
  - Dynamically render `"Where:"` vs. `"Trong đó:"` based on `language`, and localize the sticky toolbar (`New Deck`, `Slides → Pages`, `Noise Stripped`, `Copy Markdown`, `Export PDF`), verification banners, and Uncaptured Source Formulas box.
- [x] **Task 3.3 (Tier 2 — `Gemini 3.8 Flash` `high`):** Localize `components/arena/arena-entrance.tsx`, `components/arena/arena-manager.tsx`, `components/arena/arena-lobby.tsx`, and `app/arena/page.tsx`:
  - Localize all remaining hardcoded strings in `ArenaEntrance` (Host-Pays banner, empty packs notice, validation errors, player count).
  - Wire `ArenaManager`, `ArenaLobby`, and `/arena` header to `useLanguage()` (`t.arena.*`), including room code copy states, bot archetype chips, contender roster roles, match rules, and start/ready buttons.
- [x] **Task 3.4 (Tier 2 — `Gemini 3.8 Flash` `high`):** Localize `components/arena/arena-game.tsx`, `components/arena/arena-podium.tsx`, and add bilingual component tests:
  - Wire `ArenaGame` (countdown overlay, HUD metrics, question header, submitted/spectator banners, round feedback, live leaderboard) and `ArenaPodium` (victory headline, scoreboard, Post-Match Class Analytics dashboard, Gradebook CSV export button, rematch/leave actions) to `useLanguage()` (`t.arena.*`).
  - Add unit tests in `tests/unit/i18n.test.ts` verifying language switching behavior across key UI flows.
