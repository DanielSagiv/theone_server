# MVP Specification vs Current Implementation - Differences Map

**Document Created:** December 17, 2025  
**Purpose:** Comprehensive comparison between MVP specification (`mvp.md`) and actual implementation

---

## Executive Summary

| Category | MVP Spec | Current Implementation | Status |
|----------|----------|----------------------|--------|
| **Authentication** | Session-based, `/login` | JWT-based, `/signin` | ⚠️ Different approach |
| **Client Intake** | Form → Client Request + COE draft | Bot conversation → COE draft | ✅ Different but better |
| **COE Sharing** | Multi-client support | Not implemented | ❌ Missing |
| **Messaging** | COE-scoped thread | Bot conversation only | ⚠️ Different approach |
| **Notifications** | Push/SMS | Not implemented | ❌ Missing |
| **Audit Log** | Separate model | Bot audit logs only | ⚠️ Partial |
| **Assets** | Separate Asset model | Embedded in Location/Event | ⚠️ Different structure |
| **Sentiment Rules** | Separate model | Embedded in events | ⚠️ Different structure |
| **Subscriptions** | Not in MVP | Fully implemented | ✅ Beyond MVP |
| **Bot/AI** | Not in MVP | Fully implemented | ✅ Beyond MVP |

---

## 1. Authentication & User Management

### MVP Spec Says:
- `POST /v1/auth/login` - User login
- `POST /v1/auth/register` - User registration (admin only)
- `POST /v1/auth/logout` - Invalidate session
- `GET /v1/auth/validate` - Validate current session
- **Session-based authentication** with encrypted/hashed passwords
- **Magic link (client), password+2FA (admin)** - Priority 1

### Current Implementation:
- ✅ `POST /v1/auth/signin` - User login (returns JWT)
- ✅ `POST /v1/auth/signup` - User registration (public, not admin-only)
- ✅ `POST /v1/auth/logout` - Invalidate session
- ✅ `GET /v1/auth/validate` - Validate current session (JWT)
- ✅ `POST /v1/auth/verify-email` - Email verification
- ✅ `POST /v1/auth/resend-verification` - Resend verification email
- ✅ `POST /v1/auth/renew-password` - Request password reset
- ✅ `PUT /v1/auth/reset-password` - Reset password with token
- **JWT-based authentication** (not session-based)
- **Email/password** (no magic link, no 2FA yet)

### Differences:
| Item | MVP | Implementation | Impact |
|------|-----|----------------|--------|
| **Endpoint name** | `/login` | `/signin` | Minor - just naming |
| **Auth method** | Session-based | JWT-based | Different but both valid |
| **Registration** | Admin-only | Public | More open than spec |
| **Magic link** | Priority 1 | Not implemented | Missing feature |
| **2FA** | Priority 1 | Not implemented | Missing feature |
| **Email verification** | Not mentioned | Fully implemented | Beyond MVP |

---

## 2. Client Intake & COE Creation

### MVP Spec Says:
- **Client intake dialog**: Form with validation for city/area, dates, party size, budget, notes
- Creates **Client Request record** and initial COE draft
- Priority 1

### Current Implementation:
- ✅ **Bot conversation** (`create_coe_draft` tool) - Natural language input
- ✅ Creates COE draft directly (no separate Client Request model)
- ✅ AI-powered event/seat selection based on preferences
- ✅ Auto-calculates pricing, taxes, fees, deposit

### Differences:
| Item | MVP | Implementation | Impact |
|------|-----|----------------|--------|
| **Input method** | Form dialog | Bot conversation | Better UX |
| **Client Request model** | Separate model | Not implemented | Missing model |
| **AI optimization** | Not mentioned | Fully implemented | Beyond MVP |

---

## 3. COE Lifecycle & Statuses

### MVP Spec Says:
- Statuses: `draft`, `approved`, `sent`, `accepted`, `rejected`, `expired`
- Client accepts COE and pays deposit
- Admin approves then sends to client
- Priority 1

### Current Implementation:
- ✅ Statuses: `draft`, `approved`, `sent`, `accepted`, `rejected`, `expired`, `completed`, `cancelled`
- ✅ Admin can approve and send COE
- ❌ **Client accept/reject endpoints NOT implemented** (`POST /coes/:id/accept`, `/reject`)
- ✅ Payment endpoints exist but accept/reject must be implemented first

### Differences:
| Item | MVP | Implementation | Impact |
|------|-----|----------------|--------|
| **Statuses** | 6 statuses | 8 statuses (+ `completed`, `cancelled`) | Extended |
| **Accept/Reject** | Priority 1 | Not implemented | **BLOCKING** |
| **Payment flow** | After accept | Can't test without accept | **BLOCKING** |

---

## 4. COE Sharing (Multi-Client)

### MVP Spec Says:
- **COE sharing (Admin-managed)**: Admin can add/remove clients to a sharable COE
- **COE participants list**: List owner and participants (Priority 2)
- Multiple clients view same page, owners accept/reject
- Priority 1

### Current Implementation:
- ❌ **No multi-client COE support**
- ❌ **No participants list**
- ❌ **No sharing endpoints**
- COE has single `client_id` (not array)

### Differences:
| Item | MVP | Implementation | Impact |
|------|-----|----------------|--------|
| **Multi-client COEs** | Priority 1 | Not implemented | **MISSING FEATURE** |
| **Participants** | Priority 2 | Not implemented | **MISSING FEATURE** |
| **Sharing endpoints** | Required | Not implemented | **MISSING FEATURE** |

---

## 5. Payments

### MVP Spec Says:
- Compatible interface with The1 gateway
- Capture on confirmation
- Refunds supported
- Transactions log for capture/refund/release
- Idempotency keys and webhook simulation
- Priority 1

### Current Implementation:
- ✅ Global Payments integration (not "The1 gateway" - different provider)
- ✅ `POST /v1/coes/:id/payments/full` - Full payment
- ✅ `POST /v1/payments/:paymentId/refund` - Refunds
- ✅ `GET /v1/coes/:id/payments/status` - Payment status
- ✅ `GET /v1/payments/coe/:coeId` - Payment history
- ✅ Saved cards management (`/tokenize`, `/saved-cards`, etc.)
- ✅ Payment intents (`POST /v1/payments/coe/:coeId/intent`)
- ✅ Idempotency support
- ✅ Webhook endpoints (`/v1/webhooks/*`)

### Differences:
| Item | MVP | Implementation | Impact |
|------|-----|----------------|--------|
| **Payment provider** | "The1 gateway" | Global Payments | Different provider |
| **Saved cards** | Not mentioned | Fully implemented | Beyond MVP |
| **Payment intents** | Not mentioned | Fully implemented | Beyond MVP |
| **Webhooks** | Sandbox only | Full implementation | Beyond MVP |

---

## 6. Upgrades

### MVP Spec Says:
- Admin or COE owner proposes upgrade
- System revalidates, computes price delta, issues upgrade offer
- Client accepts or rejects
- On acceptance, delta payment captured and COE updated
- Priority 1

### Current Implementation:
- ✅ `GET /v1/coes/:coeId/events/:eventId/alternatives` - Alternative events
- ✅ `PUT /v1/coes/:coeId/events/:oldEventId` - Replace event
- ✅ `GET /v1/coes/:id/seat-upgrades` - Seat upgrade offers (via COE detail)
- ✅ `POST /v1/coes/:id/seat-upgrades/accept` - Accept seat upgrade
- ✅ AI-powered upgrade recommendations
- ✅ Price delta calculation
- ✅ Upgrade offers generated automatically (not manually proposed)

### Differences:
| Item | MVP | Implementation | Impact |
|------|-----|----------------|--------|
| **Upgrade proposal** | Manual (admin/owner) | Automatic (system-generated) | Different approach |
| **Event replacement** | Not mentioned | Fully implemented | Beyond MVP |
| **AI recommendations** | Not mentioned | Fully implemented | Beyond MVP |

---

## 7. Runner Assignment

### MVP Spec Says:
- Assign/update Runner
- Runner receives notification
- Track status
- Priority 1

### Current Implementation:
- ✅ `POST /v1/coes/:id/runners` - Assign runner (COE-level)
- ✅ Runner assignment at COE-level and event-level
- ✅ Runner status tracking
- ❌ **No notification system** (runner doesn't receive notification)

### Differences:
| Item | MVP | Implementation | Impact |
|------|-----|----------------|--------|
| **Assignment** | Priority 1 | ✅ Implemented | Complete |
| **Notifications** | Priority 1 | ❌ Not implemented | **MISSING** |
| **Event-level** | Not mentioned | ✅ Implemented | Beyond MVP |

---

## 8. Data Models

### MVP Spec Says:
- **User**: id, email, role, name, contact, consent timestamps
- **Location**: id, name, description, address, geo, score
- **Event**: id, location_id, name, description, start/end time, capacity, availability, base price, currency, status
- **Asset**: id, url, type, location_id/event_id, metadata (separate model)
- **SentimentRule**: id, scope, priority, text, window (separate model)
- **COE**: id, user_id, admin_id, status, totals, currency, timestamps, sharable
- **COEItem**: id, coe_id, event_id, event_date, quantity, prices, notes
- **Payment**: id, coe_id, user_id, provider, ids, amount, currency, status
- **PaymentTransaction**: id, payment_id, type, amount, raw, created_at
- **AuditLog**: actor, entity, action, snapshots, created_at (separate model)
- **RunnerAssignment**: id, coe_id, runner_user_id, assigned_by, timestamps, status

### Current Implementation:

#### ✅ Implemented Models:
- **User**: ✅ (with avatarUrl, saved_payment_methods, emailVerified, userTier)
- **Location**: ✅ (with media array, not separate Asset model)
- **Event**: ✅ (with seats array, media array, sentiment embedded)
- **COE**: ✅ (with events array, selected_seats array, runner_assignment embedded)
- **Payment**: ✅ (with Global Payments integration)
- **Subscription**: ✅ (NOT in MVP - beyond scope)

#### ⚠️ Different Structure:
- **Asset**: ❌ Separate model → ✅ Embedded as `media` array in Location/Event
- **SentimentRule**: ❌ Separate model → ✅ Embedded in Event (sentiment field)
- **COEItem**: ❌ Separate model → ✅ Embedded as `events` array in COE
- **PaymentTransaction**: ⚠️ Not separate model → Embedded in Payment or logged elsewhere
- **AuditLog**: ⚠️ Not general audit log → ✅ `BotAuditLog` model (bot-specific)
- **RunnerAssignment**: ❌ Separate model → ✅ Embedded in COE/COEItem

#### ❌ Missing Models:
- **ClientRequest**: Not implemented (COE created directly)

### Differences:
| Model | MVP | Implementation | Impact |
|-------|-----|----------------|--------|
| **Asset** | Separate | Embedded | Different structure |
| **SentimentRule** | Separate | Embedded | Different structure |
| **COEItem** | Separate | Embedded | Different structure |
| **ClientRequest** | Required | Not implemented | Missing model |
| **AuditLog** | General | Bot-specific only | Partial |
| **Subscription** | Not in MVP | Fully implemented | Beyond MVP |

---

## 9. API Endpoints

### MVP Spec Says:
- Base path: `/v1`
- Session-based auth
- Pagination: `?page=1&limit=20`
- Error model: `{ error: { code, message, details? } }`
- Idempotency: `Idempotency-Key` header
- Test Interface: EJS views at `/test/*`

### Current Implementation:
- ✅ Base path: `/v1`
- ✅ JWT-based auth (Bearer token)
- ✅ Pagination support
- ✅ Standardized error responses
- ✅ Idempotency support
- ✅ EJS test interface at `/test/*`

### Missing Endpoints (from MVP implied list):
- ❌ `POST /v1/coes/:id/accept` - Client accept COE
- ❌ `POST /v1/coes/:id/reject` - Client reject COE
- ❌ `POST /v1/coes/:id/share` - Share COE with clients
- ❌ `GET /v1/coes/:id/participants` - List participants
- ❌ `POST /v1/coes/:id/participants` - Add participant
- ❌ `DELETE /v1/coes/:id/participants/:userId` - Remove participant
- ❌ `GET /v1/notifications` - Get notifications
- ❌ `POST /v1/notifications/:id/read` - Mark read
- ❌ `GET /v1/messaging/coe/:coeId` - Get COE messages
- ❌ `POST /v1/messaging/coe/:coeId` - Send message

### Extra Endpoints (Beyond MVP):
- ✅ `GET /v1/bot/conversation` - Bot conversation history
- ✅ `POST /v1/bot/message` - Send bot message
- ✅ `GET /v1/subscriptions/*` - Subscription management
- ✅ `GET /v1/payments/saved-cards` - Saved cards
- ✅ `POST /v1/payments/tokenize` - Tokenize card
- ✅ `GET /v1/coes/:coeId/events/:eventId/alternatives` - Event alternatives
- ✅ `PUT /v1/coes/:coeId/events/:oldEventId` - Replace event
- ✅ `GET /v1/coes/:id/seat-upgrades` - Seat upgrades (via COE detail)

---

## 10. Features Comparison

### MVP Priority 1 Features:

| Feature | MVP Status | Implementation Status | Notes |
|---------|------------|----------------------|-------|
| Client intake dialog | Required | ✅ Bot conversation (better) | Different approach |
| Client COE page | Required | ✅ EJS test interface | Needs mobile |
| Locations CRUD | Required | ✅ Fully implemented | Complete |
| Events CRUD | Required | ✅ Fully implemented | Complete |
| Assets library | Required | ✅ Embedded in models | Different structure |
| Sentiment rules | Required | ✅ Embedded in events | Different structure |
| COE builder | Required | ✅ Bot + manual | Complete |
| COE workflow statuses | Required | ✅ 8 statuses | Extended |
| Approvals queue | Required | ⚠️ Manual (no queue UI) | Partial |
| COE sharing link | Required | ❌ Not implemented | **MISSING** |
| COE sharing: multi client | Required | ❌ Not implemented | **MISSING** |
| Client accept and hold | Required | ❌ Not implemented | **BLOCKING** |
| Availability revalidation | Required | ✅ Implemented | Complete |
| Payments interface | Required | ✅ Global Payments | Different provider |
| Payment capture | Required | ✅ Implemented | Complete |
| Refunds | Required | ✅ Implemented | Complete |
| Payment transactions log | Required | ✅ Implemented | Complete |
| Idempotency for payments | Required | ✅ Implemented | Complete |
| Webhook sandbox | Required | ✅ Full webhooks | Beyond MVP |
| Audit log | Required | ⚠️ Bot audit only | Partial |
| Analytics overview | Required | ✅ Statistics endpoint | Complete |
| Notifications | Required | ❌ Not implemented | **MISSING** |
| Messaging thread | Required | ❌ Not implemented | **MISSING** |
| Authentication | Required | ✅ JWT (not magic link) | Different approach |
| Authorization | Required | ✅ Role-based | Complete |
| Runner assignment | Required | ✅ Implemented | Complete (no notifications) |

### Beyond MVP (Not in Spec):
- ✅ **Bot/AI Assistant** - Fully implemented
- ✅ **Subscriptions** - Fully implemented
- ✅ **Email verification** - Fully implemented
- ✅ **Password reset** - Fully implemented
- ✅ **Event alternatives** - Fully implemented
- ✅ **Seat upgrade offers** - Fully implemented
- ✅ **Saved payment methods** - Fully implemented
- ✅ **Avatar upload** - Fully implemented
- ✅ **Admin full-access COE editing** - Fully implemented

---

## 11. Critical Gaps (Blocking MVP)

### Must Implement for MVP:
1. **Client Accept/Reject COE** (`POST /coes/:id/accept`, `/reject`)
   - **Impact**: Clients can't accept COEs, blocking payment flow
   - **Priority**: P0

2. **COE Multi-Client Sharing**
   - **Impact**: Core MVP feature missing
   - **Priority**: P0

3. **Notifications System**
   - **Impact**: Runners don't get notified, clients don't get updates
   - **Priority**: P1

4. **Messaging Thread**
   - **Impact**: No COE-scoped communication
   - **Priority**: P1

### Nice to Have (Post-MVP):
- Magic link authentication
- 2FA for admins
- General audit log (beyond bot)
- Client Request model (if needed)

---

## 12. Architecture Differences

| Aspect | MVP Spec | Current Implementation |
|--------|----------|------------------------|
| **Backend** | Node.js/TS with Express/Fastify | Node.js with Express |
| **Auth** | Session-based | JWT-based |
| **Payment Provider** | "The1 gateway" | Global Payments |
| **Data Structure** | Normalized (separate models) | Denormalized (embedded arrays) |
| **Client Intake** | Form-based | Bot conversation |
| **Upgrades** | Manual proposal | Automatic generation |

---

## 13. Summary Statistics

| Metric | Count |
|--------|-------|
| **MVP Priority 1 Features** | 25 |
| **Fully Implemented** | 18 (72%) |
| **Partially Implemented** | 2 (8%) |
| **Not Implemented** | 5 (20%) |
| **Beyond MVP Features** | 9+ |

### Implementation Status:
- ✅ **Complete**: 72% of MVP Priority 1 features
- ⚠️ **Partial**: 8% (approvals queue, audit log)
- ❌ **Missing**: 20% (accept/reject, sharing, notifications, messaging)

---

## 14. Recommendations

### Immediate (Before Mobile Launch):
1. Implement `POST /v1/coes/:id/accept` and `/reject` endpoints
2. Add accept/reject buttons to COE cards
3. Test payment flow end-to-end

### Short Term (Post-MVP):
1. Implement COE multi-client sharing
2. Add notifications system (push/SMS)
3. Add COE-scoped messaging

### Long Term:
1. Magic link authentication
2. 2FA for admins
3. General audit log system
4. Client Request model (if needed for analytics)

---

**Conclusion:** The current implementation has **72% of MVP Priority 1 features complete**, with significant enhancements beyond MVP (Bot/AI, Subscriptions). The main gaps are **client accept/reject** (blocking), **multi-client sharing** (core feature), and **notifications/messaging** (important but not blocking).







