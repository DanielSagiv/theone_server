# Project Overview - The1

This document summarizes **The1** (also styled **THE1**) across the **server** (`theone-server`) and **mobile** (`the1-mobile`) codebases. For deep dives, use the linked docs under `server/docs/MD_files/` and `mobile/docs/`.

---

## What is the product?

The1 is a **concierge-style platform** for selling and operating **curated multi-event experiences** (nightlife, venues, and related hospitality). The core unit is a **COE (Curated One Experience)**: a package that ties together **events**, **locations (venues)**, **seats/tables**, **pricing** (subtotal, taxes, fees, deposits), and **lifecycle status** from client request through proposal, acceptance, payment, optional revisions, and completion.

The **admin** (concierge) builds and proposes experiences; the **client** reviews, accepts, and pays in the mobile app; a **runner** role exists for on-site execution. An **AI bot** assists with conversation-driven flows, COE creation, and tooling. The system also supports **subscriptions**, **notifications** (push/in-app), **merge/booking** concepts for shared tables, and **multiple parallel proposals** (several COEs grouped so the client picks one winner).

---

## Who are the users?

| Role | Description |
|------|-------------|
| **Client** | End customer: requests experiences, compares multi-proposal options, accepts one COE, pays deposits/finals, receives notifications. |
| **Admin** | Concierge / operator: manages locations and events, builds COEs, proposes to clients, manages payments on behalf of clients where allowed, assigns runners, uses bot and test tools. |
| **Runner** | Field operator for executing the experience at venues (assignment and notifications exist in the model and flows). |

Additional internal or future-facing surfaces include **EJS test UIs** on the server for API exercise and **dashboard**-related documentation (see `docs/`).

---

## Main goal

Prove and deliver **end-to-end value**: turn a client’s intent into a **structured, priced experience**, get it **approved and visible** to the client, capture **payment** with correct **inventory/seat** rules, and support **operations** (revisions, multi-option choice, notifications, deployment to AWS).

The product thesis in the MVP spec is to validate this loop with minimal surface area first, then expand (upgrades, richer sharing, etc.)—see `docs/MD_files/architecture/mvp.md` and the gap analysis in `docs/MD_files/MVP-vs-IMPLEMENTATION-DIFF.md`.

---

## Core features

- **Authentication and users** — JWT-based auth (`/v1/auth/...`), roles (`admin`, `client`, `runner`), email verification and password reset flows.
- **Locations and events** — CRUD-style APIs; events with capacity, pricing, seats, performers, media; linkage to COEs.
- **COE lifecycle** — Draft/request → approved (client-visible “proposal”) → accepted / pending pay → paid → completed (plus rejected, expired, cancelled). Documented in `docs/MD_files/COE-STATUS-FLOW.md` and enforced in `services/coeService.js`.
- **Payments** — Deposits, full pay, revision diff payments; deadline fields; integration patterns documented under `docs/MD_files/payment/`.
- **Seat selection and inventory** — Selected seats on COEs; hold/release rules; merge/shared-table flows; handling when sections lack seats (see `docs/MD_files/NO-SEATS-IN-SECTION-PAYMENT-HANDLING.md`, merge docs).
- **Bot / OpenAI** — Conversational COE creation and tools; feature flags for client-created/edited COEs (`FEATURE-FLAGS.md`, `.env.example`).
- **Notifications** — In-app and push (Firebase Admin, Expo push); types for COE and proposal-group events; deep links from mobile.
- **Subscriptions** — Recurring billing and cron jobs (`utils/cronJobs.js`, subscription service).
- **Multi-proposal groups** — `proposal_group_id` on COEs plus `ProposalGroup` document; grouped “mental” row on mobile; publish-all; client picks one; losers cancelled; optional **group-level payment timer** mirrored on members (`docs/MD_files/MULTIPLE-COE-PROPOSALS-DESIGN.md`).
- **Revisions** — Paid revision workflow with `revision_state`, snapshots, and revision payment windows (separate from initial proposal payment timer).
- **Mobile app (Expo)** — Experiences list, COE detail, proposal picker carousel, payments UI, bot tab, notifications, secure token storage, staging/production API config.
- **Admin / test surfaces** — REST API under `/v1`, EJS test views where configured, deployment to **AWS ECS Fargate** (`docs/DEPLOYMENT-GUIDE.md`).

---

## Current status

- **Not a throwaway POC**: substantial **MVP+** implementation—auth, COE, payments, bot, mobile clients, cron, AWS staging/prod paths.
- **Staging / production-oriented**: deployment docs reference **stage** and **prod** clusters on AWS; mobile builds target **stage API** (`https://stage.the1.vip/v1`) for IPA-style releases per `mobile/README.md`.
- **Evolving**: many design and plan markdown files track **planned vs done** work; some MVP spec items differ from implementation (JWT vs session, sharing, etc.)—see `MVP-vs-IMPLEMENTATION-DIFF.md`.

---

## Tech stack

**Server (`theone-server`)**

- **Runtime**: Node.js  
- **Framework**: Express  
- **Database**: MongoDB (Mongoose)  
- **Auth**: JWT (jsonwebtoken), bcrypt  
- **Validation**: Joi  
- **Jobs**: node-cron (payments, COE deadlines, subscriptions, proposal-group timers)  
- **Integrations**: OpenAI, Firebase Admin (push), AWS SDK, Expo push server, Puppeteer (where used), Multer uploads  
- **Views**: EJS (test/admin tooling)  
- **Hosting**: Docker / AWS ECS Fargate (per deployment guide)

**Mobile (`the1-mobile`)**

- **Framework**: React Native with **Expo** (~54)  
- **Navigation**: Expo Router  
- **Language**: JavaScript (React 19 / RN 0.81)  
- **Storage**: Expo SecureStore (tokens)  
- **Notifications**: expo-notifications  
- **UI**: expo-linear-gradient, react-native-svg, custom theme (`src/theme/`)

**Shared contract**

- JSON **REST API** at `/v1` (see `docs/MD_files/architecture/restful-api-spec.md` for historical API notes).

---

## Notes

- **Repository layout**: This overview lives in **`server/docs/`** because most architecture markdown is there; **`mobile/`** has its own `README.md` and `docs/` for build, push, and feature plans.
- **Cursor plan files** (`.plan.md` from Cursor’s planning UI) are often stored under the user’s **`.cursor/plans/`** directory and may **not** appear in the IDE project tree when only `server/` and `mobile/` are workspace roots.
- **Single vs multi-proposal**: One COE in a group behaves like a normal experience row; two or more collapse to a **group row** on the Experiences list with a compare/picker flow (`MULTIPLE-COE-PROPOSALS-DESIGN.md`).
- **“Proposal” in the API** — persisted COE status for a client-visible offer is typically **`approved`**; the string `proposal` may be normalized to `approved` in services.
- **Feature flags** — Server-driven flags (e.g. client COE creation/editing) are documented in `docs/MD_files/FEATURE-FLAGS.md`.
- **Further reading (non-exhaustive)**  
  - COE domain: `docs/MD_files/architecture/coe-specification.md`  
  - MVP thesis: `docs/MD_files/architecture/mvp.md`  
  - Implementation vs MVP: `docs/MD_files/MVP-vs-IMPLEMENTATION-DIFF.md`  
  - Multi-proposal: `docs/MD_files/MULTIPLE-COE-PROPOSALS-DESIGN.md`  
  - Payments: `docs/MD_files/payment/PAYMENT-SYSTEM-COMPLETE.md`, `PAYMENT-IMPLEMENTATION-GUIDE.md`  
  - Bot: `docs/MD_files/architecture/bot-architecture-plan.md`, `bot-coe-creation-stage1.md`  
  - Mobile: `mobile/README.md`, `mobile/docs/BUILD-FOR-STAGE.md`, push setup docs  
  - Deploy: `docs/DEPLOYMENT-GUIDE.md`

---

*Last updated from repository structure and markdown index (March 2026). Update this file when major product or stack changes land.*
