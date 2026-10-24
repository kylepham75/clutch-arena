# Clutch Arena - Study Space & Multi-Workspace Architecture Specification

## 1. Overview & Vision
The **Study Space** panel (located in the top-left sidebar under the Clutch Arena brand mark) serves as the **Workspace Switcher and Active Environment Anchor** for Clutch Arena.

Currently, every student operates within their default personal study space:
- **Identifier:** `Your study space` (avatar badge: `S`)
- **Tagline:** `One more rep. One step closer.` (Vietnamese: `Thêm một câu. Tiến một bước.`)
- **Scope:** Personal study packs, slide decks, practice history, and AI Coach notes.

With the introduction of the **Tutor Tier (Giảng Viên & Nhóm Học)**, this component expands from a static badge into an interactive **Multi-Workspace Switcher** (similar to Notion, Slack, and Linear workspaces).

---

## 2. Workspace Hierarchy & Entity Model

```
                    ┌─────────────────────────┐
                    │      Student User       │
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
┌─────────────────────────┐             ┌──────────────────────────────────┐
│   Personal Workspace    │             │   Class / Group Workspace(s)     │
│  ("Your study space")   │             │   (Shared via Tutor/Pro Invites) │
├─────────────────────────┤             ├──────────────────────────────────┤
│ • Personal study packs  │             │ • Lecturer curated testbanks     │
│ • Custom slide summaries│             │ • Shared exam revision notes     │
│ • Solo Clutch Run stats │             │ • Group leaderboard & analytics  │
│ • Private AI Coach logs │             │ • Live multiplayer arena rooms  │
└─────────────────────────┘             └──────────────────────────────────┘
```

---

## 3. Database Schema Design (Supabase PostgreSQL)

### 3.1. `workspaces` Table
Stores all active study spaces:
```sql
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  avatar_letter CHAR(1) NOT NULL DEFAULT 'S',
  avatar_color TEXT NOT NULL DEFAULT '#6b775e',
  description TEXT,
  workspace_type TEXT NOT NULL CHECK (workspace_type IN ('personal', 'tutor_class', 'study_group')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.2. `workspace_members` Table (RBAC)
Manages membership and role-based access control:
```sql
CREATE TABLE public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'tutor', 'student', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);
```

### 3.3. Scoping Study Assets to Workspaces
Add `workspace_id UUID REFERENCES public.workspaces(id)` to:
- `user_decks`
- `clutch_notes`
- `quiz_history`
- `concept_mastery`

---

## 4. UI/UX Interaction Design

### 4.1. Workspace Dropdown Menu
Clicking the `Your study space >` button triggers a sleek popover menu:
1. **Current Active Space:** Highlighted with a green checkmark and avatar badge.
2. **Joined Spaces List:**
   - 🏫 *Corporate Finance FIN301 (Dr. Minh's Class)* (Badge: `F`)
   - 👥 *CFA Level 1 Cram Squad* (Badge: `C`)
   - 👤 *Personal Study Space (Default)* (Badge: `S`)
3. **Actions:**
   - `+ Create Study Group` (Enabled for Tutor tier)
   - `🔗 Join with Invite Code` (Open to all students via 6-character code)
   - `⚙️ Workspace Settings & Member Management`

### 4.2. Visual Feedback
- Sidebar avatar changes to reflect the active space's initial (e.g. `F` for FIN301, `C` for CFA).
- Header breadcrumb dynamically reflects: `Workspace: FIN301 > Clutch Run`.

---

## 5. Phased Implementation Roadmap

- **Phase 1 (Current State):** Static personal workspace badge with localized Vietnamese/English branding.
- **Phase 2 (Workspace Switcher UI):** Interactive dropdown popover with local state switching (Personal vs. Demo Group).
- **Phase 3 (Supabase Sync & Invites):** Real-time multi-tenant workspaces, 6-character group invite codes, and Tutor administrative dashboard.
- **Phase 4 (Collaborative Arenas):** Group-exclusive Arena tournaments and aggregate class mastery heatmaps.
