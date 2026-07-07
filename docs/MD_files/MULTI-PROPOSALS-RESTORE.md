# Multi Proposals Restore

**Feature / task name:** `multi proposals restore`  
**Status:** **PAUSED** (2026-07-07) — Phase 3 implemented, device verification incomplete; repropose / Submit Revision UI hidden in app until resume  
**Last updated:** 2026-07-07

Living tracker for restoring propose / re-propose / multi-proposal / post-payment revision flows after the Figma admin + client detail redesign. Work is **phase-by-phase**; do not start the next phase until the current phase is implemented and verified.

---

## Workflow rules

1. User asks for a **plan for Phase N** only — agent produces a focused plan (scope, files, test matrix, risks).
2. Implement **only** that phase after plan approval.
3. User **verifies** on iOS and Android (and server where relevant).
4. Mark phase **verified** in this doc, then proceed to Phase N+1.

When working on this feature, prefix work as: **`multi proposals restore` — Phase N**.

---

## Pause (2026-07-07)

**User decision:** Pause `multi proposals restore`; resume later.

**Where we left off:**

| Item | State |
|------|--------|
| Phase 0–2 | Verified |
| Phase 3 | Implemented (inline **Submit Revision**, menu + dialog wiring, bugfixes) — **not fully verified** on device |
| Phase 3 checklist | Rows 1–3 checked; rows 4–10 open (client **Accept & pay**, `deposit_diff` / `full_diff`, expire revision, regression) |
| Open test question | Paid deposit → add event → price up: client saw **Pay balance** only, not **deposit diff** — expected only after admin **Submit Revision** (`revision_state: pending_accept`) |

**UI hidden until resume:** Re-propose / **Propose Again** (menu + inline strip + legacy button) and **Submit Revision** (menu + inline strip + legacy button).

**Toggle:** [`mobile/app/coe-detail.js`](../../../mobile/app/coe-detail.js) — `MULTI_PROPOSALS_REPROPOSE_UI_VISIBLE` (currently `false`). User will ask to show repropose options again when returning to this work.

**Not hidden:** Propose Experience, Add Proposal, expire revision, client revision accept/pay footers, server APIs.

---

## Phases

| Phase | Name | Goal | Status |
|-------|------|------|--------|
| **0** | Baseline audit | Confirm existing APIs, menu items, footers, and dialogs still work; document gaps | `verified` |
| **1** | Re-propose (unpaid) | Restore/discover **Propose Again** on `approved` + unpaid | `verified` |
| **2** | Multi-proposals | **Add Proposal**, group list, publish-all, client proposal switcher, choose option | `verified` |
| **3** | Post-pay revision | **Submit Revision** after deposit/full; client/admin accept & diff pay; expire revision | `implemented — paused before device verification` |
| **4** | UX polish (optional) | Visible Figma actions and/or interim legacy buttons; cleanup | `pending` |

---

## What was not removed (design hid entry points)

- **Server:** `POST /v1/coes/:id/repropose`, `POST /v1/coes/:id/add-proposal`, proposal-group APIs, revision accept + `deposit_diff` / `full_diff` payments.
- **Mobile:** `coe-detail.js` — `AdminCoeDetailHeaderMenu` (Propose Again, Add Proposal, Submit Revision), propose dialog, `ClientCoeDetailFooter` revision CTAs, `ClientCoeDetailProposalSwitcher`.

Figma detail (`useFigmaDetailChrome`) **hides** legacy inline admin buttons; actions moved to `⋯` menu and sticky footers.

---

## Reference docs

| Topic | Doc |
|-------|-----|
| Re-propose (unpaid) | `~/.cursor/plans/coe-repropose-feature_44109a67.plan.md`, `coe-payment-time-limit_9d15894f.plan.md` |
| Paid revision (after deposit/full) | `~/.cursor/plans/coe-paid-revision_96b542b8.plan.md` |
| Multi-proposal product | `server/docs/MD_files/MULTIPLE-COE-PROPOSALS-DESIGN.md` |
| Multi-proposal client UX archive | `mobile/docs/MULTI-PROPOSAL-THREE-STEP-FLOW-ARCHIVE.md` |
| Client accept / revision pay | `mobile/docs/CLIENT-COE-ACCEPT-AND-PAY-FLOWS.md` |
| History on propose/repropose | `~/.cursor/plans/coe-change-history-log_2e2bb5c5.plan.md` |
| Admin manage events + revision guards | `server/docs/MD_files/admin_manage_coe_events.md` |

---

## Phase log

### Phase 0

- **Planned:** 2026-06-09
- **Implemented:** 2026-06-09 (code inventory + static analysis complete)
- **Verified:** 2026-07-01 (user sign-off; iOS menu + checkboxes)

### Phase 1

- **Planned:** 2026-07-01
- **Implemented:** 2026-07-01 — inline **Re-propose** on Figma admin detail; propose dialog → Modal; title **Propose Again**; repropose always sends `payment_deadline_hours` when hours field valid
- **Verified:** 2026-07-06 (user sign-off; iOS menu + checkboxes)

#### Phase 1 verification checklist

| # | Test | iOS | Android |
|---|------|-----|---------|
| 1 | **Re-propose** button visible above footer (not only `⋯`) | [ ] | [ ] |
| 2 | Modal title **Propose Again** | [ ] | [ ] |
| 3 | Change deposit % → success + client sees update | [ ] | [ ] |
| 4 | Set payment hours → countdown updates | [ ] | [ ] |
| 5 | Re-submit same hours → timer refreshes | [ ] | [ ] |
| 6 | `⋯` → Propose Again still works | [ ] | [ ] |
| 7 | Draft/request admin — unchanged legacy propose | [ ] | [ ] |

### Phase 2

- **Planned:** 2026-07-06 — plan `~/.cursor/plans/multi_proposals_phase_2_ae6b76bb.plan.md` (verify Add Proposal, group list, publish-all, switcher, choose option; fix P0-5 grouped timer). Add Proposal stays menu-only (no inline strip).
- **Implemented:** 2026-07-06 — **P0-5 fix:** unpaid `POST /:id/repropose` now blocks per-COE `payment_deadline_hours` when the COE's group has `countMembersInGroup >= 2` (mirrors the `PUT /:id/status` guard, [`routes/coes.js`](routes/coes.js)). Mobile propose dialog ([`coe-detail.js`](../../../mobile/app/coe-detail.js)) hides the payment-time-limit input (with a "set from group card" helper) and omits `payment_deadline_hours` from the repropose payload when `groupOwnsPaymentTimer` (group members >= 2). Single-COE / N=1 repropose unchanged. Static/code verification of C1–C5 wiring complete (see matrix).
- **Verified:** 2026-07-07 (user sign-off; iOS + Android checklist rows 1–8 except row 5 switcher unchecked)

#### Phase 2 verification checklist

| # | Test | CODE | iOS | Android |
|---|------|------|-----|---------|
| 1 | `⋯` → **Add Proposal** → experience-request → save sibling | Wired (`handleAddProposal`, `canAddProposalForMenu`) | [ v] | [ v] |
| 2 | Admin group card + **Propose all** publishes drafts | Wired (`shouldShowAdminProposeAll` → publish) | [ v] | [ v] |
| 3 | Group timer start/reset/cancel on mental card | Wired (group timer endpoints) | [v ] | [ v] |
| 4 | Client group card → coe-detail with option label | Wired (`ClientProposalGroupMentalCard`) | [ v] | [v ] |
| 5 | **Proposal k / N** switcher navigates siblings | Wired (`canNavigateProposalGroup`) | [ ] | [ ] |
| 6 | **Choose this option** resolves group; losers hidden | Wired (`open_multi_proposal_client_accept` → accept) | [ v] | [v ] |
| 7 | Re-propose on grouped COE: **no** per-COE hours (server + UI) | **Fixed P0-5** (server 400 + UI hides input) | [ v] | [ v] |
| 8 | Re-propose on single COE: per-COE hours still work (Phase 1 regression) | Preserved (`groupOwnsPaymentTimer` false) | [ v] | [v ] |

### Phase 3

- **Planned:** 2026-07-07 — plan `~/.cursor/plans/multi_proposals_phase_3_5c4798a1.plan.md` (verify post-pay revision; inline **Submit Revision** on Figma admin detail for paid COEs).
- **Implemented:** 2026-07-07 — `showAdminFigmaSubmitRevisionStrip` in [`coe-detail.js`](../../../mobile/app/coe-detail.js): visible **Submit Revision** above footer when `payment_status` is `deposit_paid` or `paid` and `revisionIdle`; opens existing revision dialog (`openProposeExperienceDialog({ repropose: true, revision: true })`); `⋯` menu entry unchanged. **Bugfix 2026-07-07:** menu `Submit Revision` deferred via `InteractionManager` after header menu closes (fixes modal not opening); strip gating aligned with menu (removed `isPaymentExpired` block on paid COEs). No server changes. Static/code verification of D1–D5 + E2/E3 wiring complete (see matrix).
- **Verified:** _pending user sign-off on iOS + Android — Fixtures D/E/F must be created live (none in `the1-stage` as of 2026-07-07)._

#### Phase 3 verification checklist

| # | Test | CODE | iOS | Android |
|---|------|------|-----|---------|
| 1 | **Submit Revision** visible above footer on paid Figma admin detail | **Implemented** (`showAdminFigmaSubmitRevisionStrip`) | [ v] | [v ] |
| 2 | `⋯` → Submit Revision still works | Wired (`adminHeaderMenuItems` ~1620) | [ v] | [ v] |
| 3 | Edit paid COE (price up) → submit revision → `pending_accept` | Wired (`POST /repropose` paid branch) | [ v] | [ v] |
| 4 | Client **Accept** / **Accept & pay** for increased revision | Wired (`clientFooterAcceptAction` / `clientFooterPayAction`) | [ ] | [ ] |
| 5 | `deposit_diff` / `full_diff` payment completes | Wired (`paymentService` ~313, ~341) | [ ] | [ ] |
| 6 | Decreased revision shows credit breakdown (Fixture E) | Wired (`showAcceptedFullDecreasedCreditInBreakdown`) | [ ] | [ ] |
| 7 | **Expire revision** reverts to last paid version | Wired (`POST /revision/expire`) | [ ] | [ ] |
| 8 | Revision countdown label (not payment countdown) | Wired (`revision_deadline_*` ~1402+) | [ ] | [ ] |
| 9 | Manage events blocked during pending revision | Wired (`canAdminAddEventForMenu` false) | [ ] | [ ] |
| 10 | Phase 1 + 2 regression smoke | No changes to repropose/group guards | [ ] | [ ] |

### Phase 4

- **Planned:** —
- **Implemented:** —
- **Verified:** —

---

## Phase 0 findings

### Summary

| Next phase | Readiness | Notes |
|------------|-----------|-------|
| **Phase 1** (re-propose unpaid) | **Likely ready** — mostly **discoverability** | Backend + menu + dialog wired. Legacy inline **Re-propose** hidden on Figma admin path; entry is `⋯` → **Propose Again**. User must confirm on device. |
| **Phase 2** (multi-proposals) | **Likely ready** — verify group flows on device | Add Proposal, list cards, switcher, publish-all, and APIs present. Compare carousel off by default (intentional). |
| **Phase 3** (post-pay revision) | **Likely ready** — verify end-to-end on paid COEs | Submit Revision, footers, diff payments, expire revision all coded. Depends on `revision_base_snapshot` on paid COEs. |

**Overall:** No evidence that core functionality was deleted. Primary gap is **UI discoverability** (Figma layout hides legacy buttons) plus **unverified runtime behavior** on iOS/Android.

### Test fixtures

DB fixture scan was **not run** (live Mongo query not executed in audit). Fill before manual runs:

| Fixture | Required state | Your COE ID | Notes |
|---------|----------------|-------------|-------|
| A | `draft` or `request` | _fill_ | Initial propose (legacy inline) |
| B | `approved`, `payment_status: unpaid` | _fill_ | Propose Again |
| C | 2+ COEs, same `proposal_group_id` | **none in `the1-stage` — see below** | Add Proposal, switcher, publish-all |

**Fixture C status (2026-07-06 DB scan, `the1-stage`):** No COE currently has a `proposal_group_id`; all 20 `ProposalGroup` docs are orphaned (0 members). Fixture C must be **created live** via **Add Proposal** from an approved+unpaid COE. Recommended seed COEs (approved, unpaid, no group), same client `6a02b54834378fbe496f5c75` so the sibling stays in one group:

- `6a468109dee6a7f647d3fac8` — "sagiv daniel experience, Jul 3-2026"
- `6a46806bdee6a7f647d3f2cd` — "sagiv daniel experience, Jul 3-2026"

Other approved/unpaid seeds: `6a4b9c47130e440d79b8c0f3`, `6a3e0c29665433d81bedc855`, `6a3d43391a51b80287129b68`, `6a1becf7627166f78f8f28c5`, `6a1a8c6f66e231dbc6fd2f20`. Open **Add Proposal** on a seed → completes Fixture C (2 siblings, one group) for C2/C4/C5/C6 verification.
| D | `deposit_paid`, price increased after edit | **none in `the1-stage` — create live** | Revision case `deposit_increased` |
| E | `paid`, price decreased after edit | **none in `the1-stage` — create live** | Revision case `full_decreased` (credit) |
| F | `revision_state: pending_accept` | **none in `the1-stage` — create via D1/E1 submit** | Client Accept / Accept & pay |

**Fixture D/E/F status (2026-07-07 DB scan, `the1-stage`):** Zero COEs with `payment_status: deposit_paid` or `paid`; zero with `revision_state: pending_accept`. Create fixtures live:

1. Pick an **approved + unpaid** upcoming COE (e.g. Phase 2 seeds).
2. **Fixture D:** Client pays **deposit** → admin edits (price up) → **Submit Revision**.
3. **Fixture E:** Client pays **full** on a separate COE → admin edits (price down) → **Submit Revision**.
4. **Fixture F:** Use either D or E after step 3 (revision submit sets `pending_accept`).

---

### Code inventory (Step 1)

#### Server — [`server/routes/coes.js`](routes/coes.js)

| Endpoint | Lines (approx) | Purpose | Guards |
|----------|----------------|---------|--------|
| `POST /:id/repropose` | 2135–2559 | Unpaid re-propose **or** paid revision submit | Admin only. Paid path: `deposit_paid`/`paid`, not past experience, timer > 0, `revision_base_snapshot`. Unpaid path: `status === approved` |
| `POST /:id/add-proposal` | 1614+ | Clone sibling COE | `requireAdmin` |
| `GET /proposal-groups/:id/members` | 1407+ | Switcher + list | Auth; client filtering on mobile |
| `POST /proposal-groups/:id/publish` | 1443+ | Propose all drafts in group | Admin |
| Group timer start/reset/cancel/expire | 1474–1597 | Group payment window | Admin |
| `POST /:id/revision/expire` | 2567+ | Admin revert revision | Admin; `pending_accept` or `accepted` |
| `POST /:id/accept` | 2638+ | Revision accept branch | Sets `revision_state` accepted/resolved |
| `PUT /:id/status` (propose) | 2065–2094 | Initial propose with timer | **Blocks per-COE timer** when `proposal_group_id` and memberCount ≥ 2 |

#### Server — supporting services

| File | Relevant behavior |
|------|-------------------|
| [`paymentService.js`](../../services/paymentService.js) | `deposit_diff`, `full_diff` in `createPaymentIntent` (~313, ~341); revision resolve in `updateCOEPaymentStatus` (~810+) |
| [`proposalGroupService.js`](../../services/proposalGroupService.js) | `clientMayChooseWithoutFullDeposit` → open group + N≥2 approved |
| [`coeService.js`](../../services/coeService.js) | `ensureRevisionBaseSnapshotForPaidCOE`, `applyRevisionRevertFromSnapshot`, `isRevisionStructurallyLocked` (~5490+) |

#### Mobile — entry points

| Surface | File | Gating |
|---------|------|--------|
| Admin `⋯` menu | [`coe-detail.js`](../../../mobile/app/coe-detail.js) `adminHeaderMenuItems` ~1564–1670 | `useAdminFigmaDetailForMenu`: admin, not draft/request, not request-without-events |
| **Propose Again** | Same | `canReproposeForMenu`: `status === approved'` |
| **Add Proposal** | `handleAddProposal` ~771 | `canAddProposalForMenu`: not cancelled/completed |
| **Submit Revision** | Same menu ~1608 | `payment_status` deposit_paid/paid + `revision_state` none/reverted |
| **Expire revision** | Same menu ~1620 | `pending_accept` or `accepted` |
| Propose dialog | `coe-detail.js` ~3692–3854 | `showProposeDialog && isAdmin` — **not** gated by Figma chrome |
| Legacy inline buttons | ~3516–3587 | Only when **NOT** `useFigmaDetailChrome` (~3148) |
| Client footer accept/pay | `clientFooterAcceptAction` / `clientFooterPayAction` ~1994–2070 | `useClientFigmaDetail`; revision + multi-proposal choose |
| Admin footer accept/pay | `adminFooterAcceptAction` / `adminFooterPayAction` ~2136+ | `useAdminFigmaDetail` |
| Proposal switcher | `ClientCoeDetailProposalSwitcher` ~3632+ | `canNavigateProposalGroup`: 2+ nav members |
| Group list cards | [`index.js`](../../../mobile/app/(tabs)/index.js) ~873+ | `buildGroupedCoeListItems` |
| Add Proposal destination | `experience-request` via `router.replace` ~787 | Not legacy coe-detail editor |
| Compare carousel | [`proposal-group-picker.js`](../../../mobile/app/proposal-group-picker.js) | `ADMIN_PROPOSAL_USE_COMPARE_CAROUSEL === false` default |

#### Admin UI path split

| COE status (admin) | Detail UI | Propose / Re-propose entry |
|--------------------|-----------|----------------------------|
| `draft`, `request` | Legacy scroll (`adminUsesLegacyEditableDetail`) | Inline **Propose Experience** / **Re-propose** (if applicable) |
| `approved`+ (not request-only) | Figma `ClientCoeDetailView` + footer | `⋯` menu only (legacy inline hidden) |

---

### Known suspects validation (Step 4)

| # | Suspect | Verdict |
|---|---------|---------|
| 1 | Hidden ≠ removed; menu is admin entry on Figma path | **Confirmed** — `useFigmaDetailChrome \|\| useClientRequestDetail ? null` hides legacy actions ~3148 |
| 2 | **Propose Experience** in `⋯` unreachable on draft (menu disabled on draft) | **Confirmed intentional** — `useAdminFigmaDetailForMenu` excludes draft/request; `canApproveForMenu` in menu is dead code for Figma path |
| 3 | Add Proposal → `experience-request` | **Confirmed** — `handleAddProposal` ~787 |
| 4 | Group vs per-COE timer | **Partially confirmed** — `PUT /status` blocks per-COE timer in groups (~2075). **Unpaid `POST /repropose`** does **not** check group — may set per-COE timer on grouped COE (possible inconsistency; verify in Phase 2) |
| 5 | Picker carousel dormant | **Confirmed** — `ADMIN_PROPOSAL_USE_COMPARE_CAROUSEL = false` in [`adminProposalNavigation.js`](../../../mobile/src/config/adminProposalNavigation.js) |
| 6 | Legacy paid COEs without snapshot | **Code present** — `ensureRevisionBaseSnapshotForPaidCOE` before revision submit; needs real COE test in Phase 3 |
| 7 | Client nav filter hides draft siblings | **Confirmed** — `filterClientProposalNavMembers` only `approved`, `pending_pay`, `accepted_not_paid`, `paid`, `completed` in [`proposalGroupNavigation.js`](../../../mobile/src/utils/proposalGroupNavigation.js) |

---

### Manual test matrix (Step 3)

**Legend:** `CODE` = static/code audit | `PASS` / `FAIL` / `HIDDEN` / `BLOCKED` = device verification

| # | Area | CODE | iOS | Android | Notes |
|---|------|------|-----|---------|-------|
| **A1** | Admin **Propose Again** in `⋯` on approved unpaid | Reachable via menu | _pending_ | _pending_ | Legacy **Re-propose** button HIDDEN on Figma path |
| **A2** | Re-propose dialog → submit → reload | Wired `POST /repropose` | _pending_ | _pending_ | Dialog ~3692; only sends timer if changed |
| **A3** | Client sees updated deposit/timer | Server persists fields | _pending_ | _pending_ | |
| **B1** | Draft/request **Propose Experience** inline | Legacy path only | _pending_ | _pending_ | No `⋯` menu on draft |
| **B2** | Client sees proposal after propose | `PUT /status` approved | _pending_ | _pending_ | |
| **C1** | **Add Proposal** → experience-request | Wired | _pending_ | _pending_ | |
| **C2** | Admin group mental card + **Propose all** | Wired in index.js | _pending_ | _pending_ | Needs fixture C |
| **C3** | Client group card → coe-detail | `openProposalGroupDetail` | _pending_ | _pending_ | |
| **C4** | **Proposal k / N** switcher | `canNavigateProposalGroup` | _pending_ | _pending_ | Needs 2+ siblings |
| **C5** | **Choose this option** (multi accept) | `open_multi_proposal_client_accept` | _pending_ | _pending_ | Needs open group + 2 approved |
| **C6** | Group timer vs per-COE repropose | **FIXED** — repropose now blocks per-COE timer for N>=2 (server + UI) | _pending_ | _pending_ | P0-5 resolved 2026-07-06 |
| **D1** | Edit paid COE → **Submit Revision** | Menu + inline strip + dialog revision mode | _pending_ | _pending_ | Inline strip added Phase 3 |
| **D2** | Client revision footer Accept / Accept & pay | Footer actions ~1994+ | _pending_ | _pending_ | Case-dependent |
| **D3** | **Expire revision** | Menu + `POST /revision/expire` | _pending_ | _pending_ | |
| **D4** | `deposit_diff` / `full_diff` pay drawer | paymentService + pay flow | _pending_ | _pending_ | |
| **D5** | COE history revision incidents | coeHistoryService | _pending_ | _pending_ | |
| **E1** | Single-proposal client Figma detail | Default path | _pending_ | _pending_ | Regression |
| **E2** | Payment vs revision countdown labels | Separate fields (`revision_deadline_*`) | Wired ~1402+ | _pending_ | _pending_ |
| **E3** | Manage events blocked during revision | `canAdminAddEventForMenu` false | Wired ~1506+ | _pending_ | _pending_ |

---

### Gaps for Phase 1+

| ID | Phase | Gap | Severity |
|----|-------|-----|----------|
| P0-1 | 1 | **Propose Again** only in `⋯` menu on Figma admin detail — easy to miss | Discoverability |
| P0-2 | 1 | Legacy **Re-propose** inline exists but **hidden** when `useAdminFigmaDetail` | Discoverability (not a bug) |
| P0-3 | 1 | Propose dialog is legacy card overlay (~3692), not Figma modal — possible z-index/scroll issues | Verify on device |
| P0-4 | 2 | `canApproveForMenu` **Propose Experience** in menu is unreachable (dead code on Figma path) | Low — cleanup optional |
| P0-5 | 2 | ~~Per-COE repropose timer may work on grouped COE while initial propose timer is blocked~~ **RESOLVED 2026-07-06** — repropose mirrors `PUT /status` group guard (server 400) and mobile hides the hours input + omits it from payload when group N>=2 | Fixed |
| P0-6 | 2 | Compare carousel dormant unless flag flipped | By design |
| P0-7 | 3 | Revision depends on `revision_base_snapshot`; legacy COEs use backfill | Test on real paid COE |
| P0-8 | 3 | Client switcher excludes draft siblings — admin may see more options than client | By design per filter |
| P0-9 | all | **iOS/Android manual matrix not executed in audit** | User sign-off required |

---

### Phase 0 sign-off

- [x ] User filled fixture table (COE IDs)
- [x ] Manual matrix iOS column completed
- [ x] Manual matrix Android column completed
- [x] Approved to start **Phase 1 plan**

_User: check boxes and note date when signing off._
