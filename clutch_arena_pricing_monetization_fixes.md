# 🛠️ CLUTCH ARENA — Dual-Market Pricing, Unit Economics & Monetization Fix Specification

> **Document Purpose:** Actionable remediation plan and Dual-Market (`Vietnam` vs. `Rest of the World`) pricing specification based on the Founder Skill audit (`CFO`, `Pricing`, `Offer`, `Product`, and `Ops` lenses)
>
> **Target Files:** `lib/pricing/tiers.ts`, `components/pricing/pricing-modal.tsx`, `components/notes/before-after-modal.tsx`, `lib/payments/payos.ts`, `app/api/payments/payos/verify/route.ts`, `app/api/webhooks/payos/route.ts`
>
> **Priority:** Pre-Phase 2 Billing Rollout (P0 / P1)

---

## 📋 Executive Summary of Required Fixes

While Clutch Arena's PayOS v2 VietQR polling and cumulative COGS degradation engine (`full` -> `gentle` -> `hard` -> `halted`) provide a strong technical foundation, **7 structural fixes** are required to cleanly separate **Vietnam** from the **Rest of the World (RoW)** while protecting unit margins and semester LTV:

1. **Formalize Distinct Vietnam (`VND`) vs. Rest of the World (`USD`) Pricing:** Calibrate each tier to local purchasing power ($38\%$ to $60\%$ PPP adjustment in Vietnam) while raising underpriced Rest-of-World tiers (`$4.99` Cram Pass, `$9.99/mo` Pro Monthly anchor, `$24.99/mo` Tutor & Guild) to absorb international gateway fees and match Western EdTech willingness to pay.
2. **Split `cogsCeilingUsd` by Billing Region (`VND` vs. `USD`):** Applying global USD cost ceilings (`$9.75` and `$1.25`) to PPP-discounted Vietnam plans allows power users to burn up to $84.1\%$ of gross Vietnam revenue on LLM tokens alone.
3. **Stop Cram Pass from Cannibalizing Semester Pro:** Buying 2 to 4 separate 7-Day Cram Passes is currently cheaper than buying 1 Clutch Pro Semester Pass while unlocking nearly identical quotas (`12 decks`, `10-file synthesis`).
4. **Fix Badge Anchoring & Add a Monthly Decoy Plan:** Highlighting the one-time Cram Pass as "Recommended" without a monthly recurring anchor steers buyers away from 4-month Semester commitments.
5. **Resolve Internal Quota & Live UI Contradictions:** Align daily note limits with total deck credits, raise Tutor deck caps from `50` to `150/mo`, and align paywall copy (`20` or `30` questions) with the live UI buttons.
6. **Decouple Geo-IP Pricing from UI Language (`EN | VI`) + Payment-Method Geo-Locking:** Route Vietnam vs. Rest-of-World pricing via server-side Geo-IP rather than the navbar language switcher, and lock `VND` pricing strictly to domestic VietQR so VPN users cannot pay Vietnam prices with international credit cards.
7. **Harden PayOS Promo Price & Order-Suffix Verification:** Enforce strict server-side `paidAmount === expectedAmount` checks on deterministic order suffixes and lock `5,000đ` sandbox tests to admin allowlists.

---

## 1. Dual-Market Pricing Architecture: Vietnam vs. Rest of the World

Clutch Arena operates two strictly separated regional price books—**Vietnam (`VN`)** and **Rest of the World (`ROW`)**—calibrated to local student purchasing power, payment rails, and gateway fee structures (using $\$1\text{ USD} \approx 25,800\text{ VND}$).

### 1.1 Side-by-Side Regional Price Schedule

| Tier & Billing Cycle | Vietnam Market (`VN` — VND) | VN USD Equiv. | Rest of World (`ROW` — USD) | PPP Discount in VN | Target Buyer & Psychological Anchor |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Contender** *(Perpetual Free)* | **`0đ`** | $\$0.00$ | **`$0.00`** | — | Viral top-of-funnel; join any `/arena` room & import `#pack=` links free. |
| **7-Day Cram Pass** *(One-Time, No Auto-Renew)* | **`69,000đ`** | $\approx \$2.67$ | **`$4.99`** | $-46.5\%$ | **VN:** $\approx 2$ cups of milk tea.<br>**ROW:** $\approx 1$ campus iced latte. |
| **Clutch Pro Monthly** *(Recurring Decoy Anchor)* | **`109,000đ / mo`** | $\approx \$4.22$ | **`$9.99 / mo`** | $-57.8\%$ | Anchors the Semester Pass as an instant $27\%$ to $31\%$ discount. |
| **Clutch Pro Semester** *(4-Month Term — **Best Value**)* | **`299,000đ / 4 mos`**<br>*(~74,750đ/mo — Save $31\%$)* | $\approx \$11.59$ | **`$29.00 / 4 mos`**<br>*($\$7.25$/mo — Save $27\%$)* | $-60.0\%$ | Locks in full-semester LTV upfront; eliminates post-midterm churn. |
| **Tutor & Guild** *(Monthly B2B2C)* | **`399,000đ / mo`** | $\approx \$15.47$ | **`$24.99 / mo`** | $-38.1\%$ | **VN:** Independent IELTS/SAT/Uni tutors.<br>**ROW:** TAs, study guilds & private tutors. |

### 1.2 Why Each Market Has Different Price Points & Rules

1. **Vietnam Market (`VN` — High-Volume Viral Campus Strategy):**
   * **Payment Rail:** **PayOS v2 Dynamic VietQR** (`MBBank`, `Vietcombank`, `MoMo`, `ZaloPay`, `Viettel Money`). Over $85\%$ of Vietnamese students lack international Visa/Mastercard cards, making domestic QR scan-to-pay mandatory.
   * **Gateway Cost:** PayOS / VietQR fees are ultra-low ($\approx \$0.03$ to $\$0.15$ per order), allowing profitable micro-transactions at `69,000đ` without fixed `$0.50` card surcharges.
2. **Rest of the World (`ROW` — High-Margin Merchant-of-Record Strategy):**
   * **Payment Rail:** **LemonSqueezy** or **Polar.sh** (`Apple Pay`, `Google Pay`, `Visa/Mastercard`, local EU/UK/AU methods) with automated global VAT/GST/Sales Tax remittance.
   * **Gateway Cost:** Merchant of Record platforms charge $5\% + \$0.50$ base plus $+1.5\%$ international/payout fees. Pricing the Cram Pass at **`$4.99`** (instead of `$3.99`) and Tutor & Guild at **`$24.99/mo`** (instead of `$19.99/mo`) absorbs fixed transaction fees and matches Western student/tutor benchmarks (Quizlet Plus, Kahoot EDU, Gizmo).
3. **Built-In Anti-VPN Arbitrage Moat (Payment-Method Geo-Locking):**
   * You do **not** need invasive VPN blockers that break campus Wi-Fi. Simply bind **`VND` prices exclusively to PayOS VietQR** and **`USD` prices exclusively to LemonSqueezy / Polar.sh**.
   * Even if a student in the US or Europe uses a Vietnam VPN to view `69,000đ` or `299,000đ`, **foreign credit cards, Apple Pay, and PayPal cannot scan or settle a domestic Vietnamese NAPAS VietQR code**. To pay with an international card or Apple Pay, the user is automatically routed to the **`USD` Rest-of-World checkout**.

---

## 2. Unit Economics & Regional COGS Ceiling Fixes (`CFO Lens`)

### 2.1 Split `cogsCeilingUsd` by Billing Currency (`VND` vs. `USD`)

* **The Problem:** Currently, `lib/pricing/tiers.ts` uses one global USD cost ceiling (`$1.25` for Cram Pass, `$9.75` for Clutch Pro). In Vietnam, `299,000đ` equals $\approx \$11.59\text{ USD}$—meaning a `$9.75` token ceiling lets a heavy user or shared login burn **$84.1\%$ of gross revenue**, leaving just $\$1.12$ across 4 months after $\$0.72$ in realtime infrastructure costs.
* **The Fix:** Refactor `cogsCeilingUsd` into `{ vnd: number; usd: number }` so `evaluateCogsDegradation()` (`full` -> `gentle` -> `hard` -> `halted`) enforces ceilings proportional to the currency actually paid:

| Tier | Region | Gross Price (USD Equiv.) | Est. Gateway Fee | Max AI COGS Ceiling (`cogsCeilingUsd`) | Worst-Case Net Margin (At Ceiling) | Expected Avg. Net Margin |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Contender (Free)** | `VN` | `$0.00` | `$0.00` | **`$0.03 / mo`** | — | Subsidized by paid tiers |
| **Contender (Free)** | `ROW` | `$0.00` | `$0.00` | **`$0.05 / mo`** | — | Subsidized by paid tiers |
| **7-Day Cram Pass** | `VN` | `$2.67` (`69kđ`) | `~$0.03` | **`$0.45 / pass`** | **`$2.14` ($80.1\%$)** | **`~$2.45` ($91.8\%$)** |
| **7-Day Cram Pass** | `ROW` | `$4.99` | `~$0.82` | **`$1.10 / pass`** | **`$3.02` ($60.5\%$)** | **`~$3.85` ($77.2\%$)** |
| **Clutch Pro (Monthly)** | `VN` | `$4.22` (`109kđ`) | `~$0.05` | **`$0.75 / mo`** | **`$3.24` ($76.8\%$)** | **`~$3.65` ($86.5\%$)** |
| **Clutch Pro (Monthly)** | `ROW` | `$9.99` | `~$1.15` | **`$2.25 / mo`** | **`$6.41` ($64.2\%$)** | **`~$8.10` ($81.1\%$)** |
| **Clutch Pro (Semester)** | `VN` | `$11.59` (`299kđ`) | `~$0.10` | **`$2.20 / 4 mos`** | **`$8.57` ($73.9\%$)** | **`~$9.60` ($82.8\%$)** |
| **Clutch Pro (Semester)** | `ROW` | `$29.00` | `~$2.39` | **`$7.50 / 4 mos`** | **`$18.39` ($63.4\%$)** | **`~$24.20` ($83.4\%$)** |
| **Tutor & Guild (Mo)** | `VN` | `$15.47` (`399kđ`) | `~$0.15` | **`$3.00 / mo`** | **`$11.92` ($77.1\%$)** | **`~$13.50` ($87.3\%$)** |
| **Tutor & Guild (Mo)** | `ROW` | `$24.99` | `~$2.12` | **`$6.50 / mo`** | **`$15.97` ($63.9\%$)** | **`~$20.40` ($81.6\%$)** |

*(Note: Sandbox / Promo `5,000đ` test transactions must be hard-capped at a **`$0.05`** COGS ceiling.)*

---

## 3. Tier Architecture & Anti-Cannibalization Fixes (`Pricing & Offer Lens`)

### 3.1 Differentiate Cram Pass from Semester Pro

* **The Problem:** Buying two Cram Passes for Midterms and Finals costs $2 \times 69,000\text{đ} = 138,000\text{đ}$ in Vietnam (or $2 \times \$4.99 = \$9.98$ globally)—undercutting Semester Pro (`299,000đ` / `$29.00`) by $54\%$ to $65\%$ while previously offering `12 decks` and `10-file synthesis`.
* **The Fix:** Scope **7-Day Cram Pass** strictly to single-exam survival and reserve heavy multi-course synthesis for **Clutch Pro**:
  * **Cram Pass Deck Credits:** Reduce from `12 decks` -> **`5 decks`** per 7-day pass.
  * **Cram Pass Multi-Doc Synthesis:** Cap at **`Up to 5 files (15MB)`** per upload; keep **`Up to 10 files (25MB)`** exclusive to **Clutch Pro** and **Tutor & Guild**.
  * **Continuous Mastery & Cloud Sync:** Position **Clutch Pro (Semester)** around continuous 4-month **Weak-Spot Sprint** retention across both Midterms and Finals.

### 3.2 Fix Badge Anchoring & Add Risk-Reversal Guarantee

* **Default Highlight:** Move the primary **"Best Value / Recommended"** badge to **Clutch Pro (Semester)** (`299,000đ` / `$29.00`), displaying the monthly price (`109,000đ/mo` / `$9.99/mo`) as a comparison anchor (`Save 31%` in VN / `Save 27%` in RoW). Badge **7-Day Cram Pass** as *"48h Exam Sprint"*.
* **Risk-Reversal Trust Footer (`PricingModal`):**
  * **EN:** *"100% Verbatim Citation Guarantee — Every question & formula links to your exact slide/page, or get a full refund."*
  * **VI:** *"Cam kết trích dẫn nguyên văn 100% từ tài liệu của bạn — Hoàn tiền ngay nếu AI tự bịa kiến thức ngoài giáo trình."*

---

## 4. Product Quota & UI Alignment Fixes (`Product Lens`)

### 4.1 Resolve the Deck Credits vs. Daily Notes Paradox

* **The Problem:** Clutch Pro caps uploads at `50 decks` per semester yet advertises `30 decks/day` of Clutch Notes; Tutor & Guild charges `399,000đ` / `$24.99` yet caps total uploads at the same `50 decks` as a student.
* **The Fix:** Synchronize deck credits and Clutch Notes AI quotas across all tiers:
  * **Contender (Free):** `2 decks / month` + `1 Clutch Notes preview / month`.
  * **7-Day Cram Pass:** `5 decks / pass` + `Up to 5 full Clutch Notesheets / pass`.
  * **Clutch Pro (Monthly):** `15 decks / month` + `15 full Clutch Notesheets / month` (`max 8 / day` burst cap).
  * **Clutch Pro (Semester):** `60 decks / semester` + `60 full Clutch Notesheets / semester` (`max 10 / day` burst cap).
  * **Tutor & Guild (Monthly):** **`150 decks / month`** + `150 full Clutch Notesheets / month` (`max 25 / day` burst cap).

### 4.2 Align Question Count Gates with Live UI Controls

* **The Problem:** Paywall strings reference `10–15` free questions and `25 or 35` paid questions, whereas the live workspace selector displays **`10`**, **`20`**, and **`30`** questions (`10 câu`, `20 câu`, `30 câu`).
* **The Fix:** Standardize `tiers.ts` and `pricing-modal.tsx` to **`10 questions`** on Contender (Free) and **`10, 20, or 30 questions`** on Cram Pass, Pro, and Tutor & Guild.

### 4.3 Add Socratic Coach Teaser on Free Tier & Tutor Lead-Gen Rows

* **Socratic Coach Teaser:** Instead of hard-locking AI Socratic Coach at `0` messages on Free, grant **`2 free Coach debrief replies per completed run`** after a heart-loss game over, then gate deeper follow-ups.
* **Tutor & Guild Comparison Rows:** Explicitly list **Custom Branded Study Packs (Logo & Enrollment CTA)** and **Persistent Class Room Codes & Workspaces** in `pricing-modal.tsx`.

---

## 5. Geo-IP Routing & Payment Security Fixes (`Ops Lens`)

### 5.1 Decouple Geo-IP Billing Region from UI Language (`EN | VI`)

* **The Problem:** Tying `VND` vs. `USD` pricing to the `EN | VI` UI toggle forces English-curriculum students in Vietnam (RMIT, UEH ISB, FTU, VinUni) onto USD credit-card checkouts they cannot pay, while letting overseas users switch the UI to `VI` to see `VND` prices.
* **The Fix:**
  1. Resolve `billingRegion: 'VN' | 'ROW'` on the server via Vercel/Cloudflare Geo-IP headers (`x-vercel-ip-country === 'VN'` or `cf-ipcountry === 'VN'`), with `ROW` as the safe fallback.
  2. Keep `locale: 'vi' | 'en'` purely for interface text and AI explanation language.
  3. A user physically in Ho Chi Minh City using `EN` mode sees **English UI copy + `69,000đ / 299,000đ` prices + PayOS VietQR checkout**.
  4. A user outside Vietnam using `VI` mode sees **Vietnamese UI copy + `$4.99 / $29.00` prices + LemonSqueezy/Polar USD checkout** (unless they explicitly select domestic VietQR with a valid Vietnamese bank app).

### 5.2 Harden PayOS Order-Suffix & Promo Amount Verification

* **The Fix:**
  1. Map deterministic plan suffixes cleanly: `1` = `cram_pass`, `2` = `pro_semester`, `3` = `pro_monthly`, `4` = `tutor_guild`.
  2. Persist an immutable `pending_orders` row (`order_code`, `user_id`, `plan_id`, `billing_region`, `expected_amount_vnd`, `is_sandbox_test`) before returning the VietQR URL.
  3. In `/api/webhooks/payos` and `/api/payments/payos/verify`, verify both the `PAYOS_CHECKSUM_KEY` HMAC-SHA256 signature **and** `paidAmount === pendingOrder.expected_amount_vnd` before unlocking entitlements.
  4. Restrict `5,000đ` promo/test orders strictly to `ADMIN_TEST_EMAILS` with a `$0.05` sandbox COGS ceiling.

---

## 6. Master Before-vs-After Configuration Matrix

| Parameter | Current State (`pricing.txt`) | Fixed Target Specification (`VN` vs. `ROW`) |
| :--- | :--- | :--- |
| **Vietnam (`VN`) Prices** | Free: `0đ`<br>Cram: `69,000đ`<br>Pro Sem: `299,000đ`<br>Tutor: `399,000đ/mo` | Free: **`0đ`**<br>Cram (7d): **`69,000đ`**<br>Pro Monthly: **`109,000đ/mo`**<br>Pro Semester (4m): **`299,000đ`**<br>Tutor & Guild: **`399,000đ/mo`** |
| **Rest of World (`ROW`) Prices** | Free: `$0`<br>Cram: `$3.99`<br>Pro Sem: `$29.00`<br>Tutor: `$19.99/mo` | Free: **`$0`**<br>Cram (7d): **`$4.99`**<br>Pro Monthly: **`$9.99/mo`**<br>Pro Semester (4m): **`$29.00`**<br>Tutor & Guild: **`$24.99/mo`** |
| **Payment Gateways** | Coupled to `EN` / `VI` UI switcher | **`VN` Geo-IP:** PayOS v2 VietQR (`VND`)<br>**`ROW` Geo-IP:** LemonSqueezy / Polar.sh (`USD`) |
| **COGS Ceiling — `VN` (`VND`)** | Same as USD (`$0.05` / `$1.25` / `$9.75` / `$7.00`) | Free: **`$0.03`** \| Cram: **`$0.45`** \| Pro Mo: **`$0.75`** \| Pro Sem: **`$2.20`** \| Tutor: **`$3.00`** |
| **COGS Ceiling — `ROW` (`USD`)** | `$0.05` / `$1.25` / `$9.75` / `$7.00` | Free: **`$0.05`** \| Cram: **`$1.10`** \| Pro Mo: **`$2.25`** \| Pro Sem: **`$7.50`** \| Tutor: **`$6.50`** |
| **Document Deck Credits** | Free: `3` (life) \| Cram: `12` \| Pro: `50` \| Tutor: `50` | Free: **`2/mo`** \| Cram: **`5`** \| Pro Mo: **`15/mo`** \| Pro Sem: **`60/sem`** \| Tutor: **`150/mo`** |
| **Multi-Doc Synthesis** | Free: `1` \| Cram/Pro/Tutor: `10 files (25MB)` | Free: **`1`** \| Cram: **`5 files (15MB)`** \| Pro & Tutor: **`10 files (25MB)`** |
| **Questions per Run** | Free: `10–15` \| Paid: `Up to 35` | Free: **`10`** \| Paid: **`10, 20, or 30`** (matches live UI) |
| **AI Socratic Coach (Free)** | `Locked` (`0` messages) | **`2 free debrief messages / run`** after losing 3 hearts |

---

## 7. 4-Stage PM Orchestration Roadmap & Execution Plan

### Stage 1: Dual-Market Pricing Architecture, Plan Expansion & Regional COGS Degradation Engine
- [x] **Task 1.1 (Tier 1): Define Dual-Market Types, BillingRegion, and Plan Structures in `lib/pricing/tiers.ts`**
  - [x] Add `BillingRegion = 'VN' | 'ROW'`.
  - [x] Expand `UserTier` / `PlanId` to include `pro_monthly` (`clutch-pro-monthly`).
  - [x] Refactor `PlanPricing` to support dual-market pricing (`pricing: Record<BillingRegion, { amount: number; currency: 'VND' | 'USD'; formatted: string }>`).
  - [x] Synchronize quotas across tiers: Contender (`2 decks/mo`, `1 preview/mo`, `10 questions`, `2 coach replies`), Cram Pass (`5 decks/pass`, `5 notes/pass`, `5 files / 15MB`, `10/20/30 questions`), Pro Monthly (`15 decks/mo`, `15 notes/mo`, `10 files / 25MB`, max 8/day), Pro Semester (`60 decks/sem`, `60 notes/sem`, `10 files / 25MB`, max 10/day), Tutor & Guild (`150 decks/mo`, `150 notes/mo`, `10 files / 25MB`, max 25/day).
- [x] **Task 1.2 (Tier 2): Split `cogsCeilingUsd` by Region & Update Degradation Evaluator**
  - [x] Split `cogsCeilingUsd` into `{ VN: number; ROW: number }` per tier (Contender: `0.03`/`0.05`, Cram: `0.45`/`1.10`, Pro Mo: `0.75`/`2.25`, Pro Sem: `2.20`/`7.50`, Tutor: `3.00`/`6.50`).
  - [x] Update `evaluateCogsDegradation()` to accept `billingRegion` parameter (defaulting to `'VN'`).
- [x] **Task 1.3 (Tier 2): Synchronize Pricing & Degradation Unit Tests in `tests/unit/pricing-and-tiers.test.ts`**
  - [x] Update unit test assertions for new deck quotas, dual pricing schedules, and regional degradation ceilings.
  - [x] Verify zero regressions in existing pricing and auth tests (`npm test tests/unit/pricing-and-tiers.test.ts`).

### Stage 2: Geo-IP Billing Region Resolution & Language Decoupling
- [x] **Task 2.1 (Tier 2): Implement `lib/pricing/region.ts` Server & Client Helpers**
  - [x] Detect country code from headers (`x-vercel-ip-country`, `cf-ipcountry`) with safe `'ROW'` fallback.
  - [x] Parse and set `clutch_region` cookie (`VN` vs `ROW`), strictly decoupled from `locale: 'vi' | 'en'`.
  - [x] Provide helper functions `getBillingRegion()`, `getEffectiveCurrency()`, and `formatRegionalPrice()`.
- [x] **Task 2.2 (Tier 2): Integrate Region Resolution into Middleware & Server Context**
  - [x] Wire region detection into `middleware.ts` or layout/API context so downstream components receive validated `billingRegion`.
- [x] **Task 2.3 (Tier 2): Unit Tests for Geo-IP Region Resolution & Locale Independence**
  - [x] Create `tests/unit/region.test.ts` verifying country header detection, cookie persistence, and Vietnamese/English language decoupling.

### Stage 3: PayOS Suffix Architecture, Amount Integrity & Payment Security Hardening
- [x] **Task 3.1 (Tier 2): Implement 4-Plan Order Suffix Mapping in `lib/payments/payos.ts`**
  - [x] Update `generatePayosOrderCode` and `decodePlanFromOrderCode` to support: `1` = `cram_pass`, `2` = `pro_semester` (or `pro`), `3` = `pro_monthly`, `4` = `tutor_guild` (or `tutor`).
  - [x] Support both VND standard pricing and sandbox testing amounts.
- [x] **Task 3.2 (Tier 2): Enforce Server-Side Amount Verification & Sandbox Protection**
  - [x] In `/api/payments/payos/verify` and `/api/webhooks/payos`, verify `paidAmount === pendingOrder.expected_amount_vnd` and HMAC signature before fulfilling.
  - [x] Restrict `5,000đ` sandbox promo pricing strictly to `ADMIN_TEST_EMAILS` with a `$0.05` COGS cap.
- [x] **Task 3.3 (Tier 2): Unit Tests for PayOS Order Suffixes & Anti-Tamper Security**
  - [x] Update `tests/unit/payos.test.ts` with test cases for all 4 plan suffixes, payment amount validation, and sandbox allowlisting.

### Stage 4: Frontend Dual-Market Pricing UI, Decoy Anchoring & Conversion Gates
- [x] **Task 4.1 (Tier 2): Update `components/pricing/pricing-modal.tsx` with Dual Currency & Decoy Plan**
  - [x] Render VND prices + VietQR flow for `VN` region, and USD prices + international checkout for `ROW` region.
  - [x] Display `Clutch Pro Monthly` alongside `Clutch Pro Semester`, anchoring Semester as "Best Value" (Save 31% VN / 27% ROW) and Cram Pass as "48h Exam Sprint".
- [x] **Task 4.2 (Tier 1): Add Tutor Comparison Rows, Question Count Alignment & Trust Footer**
  - [x] Add Tutor branding/workspace comparison rows.
  - [x] Align question count copy to `10`, `20`, or `30` questions.
  - [x] Add **100% Verbatim Citation Guarantee** risk-reversal footer in EN and VI.
- [x] **Task 4.3 (Tier 2): Synchronize Notes Paywall & Socratic Debrief Teaser**
  - [x] Update `components/notes/before-after-modal.tsx` with aligned quotas and free 2-message Socratic coach teaser.