# The1 Platform - MVP Specification v2

## 1. Product thesis
Deliver a single focused MVP that proves client value with minimal surface area: a concierge operated app/console/flows that turns a client request into a COE proposal and payment.  
MVP also validates collaborative experiences by allowing Admins to add multiple clients to a single COE. In future iterations, clients themselves will be able to share their COE with peers.  
MVP also supports value expansion via Upgrades. Admins and COE owners can propose scoped upgrades to an existing COE. Upgrades revalidate availability and charge only the price delta.

## 2. User roles
**Admin - Concierge**: manages locations and events, builds/authorizes COE, sends to client, captures payment, assigns runner.  
**Client**: submits request, reviews COE, accepts and pays deposit. May be added to an existing COE by an Admin (and later, by the COE owner).  
**Runner**: on-premise go-getter  
- Coordinate with venue staff and vendors  
- Track the event timeline and cue activities  
- Troubleshoot problems in real time  
- Keep the client informed and comfortable  
- Perform quality checks on setup, service, and flow  

Admin and COE owner can propose upgrades and approve or reject upgrade offers.

## 3. End to end flow
- Client submits a request: city or area, date window, party size, budget, preferences.  
- Admin/System curates locations and events, adds notes and sentiment if relevant.  
- The system/Admin builds a COE draft with line items, totals, policy blocks, and sequencing.  
- Admin approves the COE then sends/release draft to client.  
- Client receives the draft, can communicate, accepts terms, and pays the deposit.  
- Admin can add clients to a COE, making it sharable. Shared clients can accept terms and participate in payments.  
- System revalidates availability, then captures payment.  
- Confirmation sent, audit log updated.  
- *Upgrade flow*: Admin or COE owner proposes upgrade, system revalidates, computes price delta, issues upgrade offer. Client accepts or rejects. On acceptance, delta payment captured and COE updated.

## 4. Scope - MVP features
### 4.1 Client intake
- Form with validation for city/area, dates, party size, budget, notes.  
- Creates Client Request record and initial COE draft.  
- Upgrades: create upgrade option, preview price delta, send to COE owner/participants.

### 4.2 Admin console
- Locations CRUD with photos, address, geo, score.  
- Events CRUD with location, datetime, capacity, availability, price, currency, assets.  
- Assets library with uploads (images, videos, seats, recommendations).  
- Sentiment rules to influence recommendations.  
- COE builder (add/remove events, reorder, notes, policies).  
- Statuses: draft, approved, sent, accepted, rejected, expired.  
- Approvals queue for drafts.  
- Runner assignment: assign/update Runner. Runner receives notification.  
- COE sharing (Admin-managed). Admin can add/remove clients to a sharable COE.  
- Upgrades: create proposals, preview deltas, send to participants.

### 4.4 Payments
- Compatible interface with The1 gateway.  
- Capture on confirmation. Refunds supported.  
- Transactions log for capture/refund/release.  
- Idempotency keys and webhook simulation for sandbox.

### 4.5 Integrity and audit
- Revalidate event availability before capture.  
- Audit log for status changes, payments, and contracts.

## 5. Data model summary
- **User**: id, email, role, name, contact, consent timestamps.  
- **Location**: id, name, description, address, geo, score.  
- **Event**: id, location_id, name, description, start/end time, capacity, availability, base price, currency, status.  
- **Asset**: id, url, type, location_id/event_id, metadata.  
- **SentimentRule**: id, scope, priority, text, window.  
- **COE**: id, user_id, admin_id, status, totals, currency, timestamps, sharable.  
- **COEItem**: id, coe_id, event_id, event_date, quantity, prices, notes.  
- **Payment**: id, coe_id, user_id, provider, ids, amount, currency, status.  
- **PaymentTransaction**: id, payment_id, type, amount, raw, created_at.  
- **AuditLog**: actor, entity, action, snapshots, created_at.  
- **RunnerAssignment**: id, coe_id, runner_user_id, assigned_by, timestamps, status.

## 6. API surface - MVP
- **Base path**: `/v1`  
- **Auth**: Session-based authentication with encrypted/hashed passwords  
- **Session Management**: Login endpoint returns session token, validate session on protected routes  
- **Idempotency**: `Idempotency-Key` on POST that creates state/charges  
- **Pagination**: `?page=1&limit=20` returns { data, page, limit, total }  
- **Error model**: `{ error: { code, message, details? } }`  
- **Test Interface**: EJS views at `/test/*` for API testing and validation

### 6.1 Authentication Endpoints
- `POST /v1/auth/login` - User login, returns session token
- `POST /v1/auth/logout` - Invalidate session
- `GET /v1/auth/validate` - Validate current session
- `POST /v1/auth/register` - User registration (admin only)

### 6.2 User Management
- `GET /v1/users/profile` - Get current user profile
- `PUT /v1/users/profile` - Update user profile
- `GET /v1/users` - List users (admin only)

Includes endpoints for client requests, COE lifecycle, upgrades, payments, runner assignments, assets, sentiment rules, audit logs, analytics, notifications, and webhooks.

## 7. Test Interface & Security
### 7.1 Test Interface (EJS Views)
- **Purpose**: Internal testing interface to validate API endpoints
- **Location**: `/test/*` routes serving EJS templates
- **Features**:
  - Login page for testing authentication
  - API endpoint testing forms
  - Session management testing
  - Response visualization
  - Error handling demonstration

### 7.2 Security Measures
- **Password Security**: 
  - Passwords encrypted using bcrypt with salt rounds
  - Password hashing on registration and updates
- **Session Management**:
  - JWT tokens for session validation
  - Session expiration handling
  - Secure session storage
- **API Security**:
  - Input validation and sanitization
  - Rate limiting on authentication endpoints
  - CORS configuration for client applications

## 8. UX notes
- Client link: clean mobile-first COE page with itinerary, price, policies, accept button.  
- Sharable COEs: multiple clients view same page. Owners accept/reject.  
- Upgrade flow: COE owner can propose upgrade, review deltas, accept/reject. Payment for delta only.

## 9. Architecture
- **API Type**: RESTful API serving multiple client applications (web, mobile).  
- **Backend**: Node.js/TS with Express/Fastify.  
- **DB**: MongoDB.  
- **Storage**: S3 for media.  
- **Payments**: The1 gateway interface.  
- **Auth**: Session-based authentication with encrypted/hashed passwords.  
- **Test Interface**: EJS views for API testing (internal client simulation).  
- **Deploy**: ECS Fargate.  
- **Observability**: structured logs, request ids, CloudWatch.

## 10. Stack and Environments
- Node.js/TS backend, MongoDB DB.  
- RESTful API serving web and mobile clients.  
- EJS test interface for API validation.  
- ECS deploy, S3 storage, ECR for containers.  
- Terraform for infra as code.  
- GitHub repo, CI/CD pipeline.  
- Separate dev/stage/prod.

## 11. Acceptance criteria
- Client submits request and receives COE.  
- Admin creates location/event.  
- Admin builds COE, approves, sends. Client views.  
- Messaging enabled.  
- Client accepts and pays. Admin captures payment.  
- Audit log records all actions.  
- Analytics overview works.  
- Runner assignment visible.  
- COE sharable with multiple clients.  
- Upgrade offers supported.

## 12. Delivery plan
**Phase 1**: Foundation & setup (User schema, authentication, session management, test interface).  
**Phase 2**: Core API endpoints (Locations, Events, basic CRUD).  
**Phase 3**: COE lifecycle & client experience.  
**Phase 4**: Payments & integrity.  
**Phase 5**: Runner & assignments.  
**Phase 6**: Analytics & observability.

## 12.1 Initial Implementation Focus
**Starting Point**: User definition, schema, and authentication system
- **User Schema**: Define User model with roles (admin, client, runner)
- **Authentication Endpoints**: Login, logout, session validation
- **Password Security**: bcrypt encryption and hashing
- **Session Management**: JWT token-based sessions
- **Test Interface**: EJS login page and basic API testing
- **Database Setup**: MongoDB connection and User collection

## 13. Risks and mitigations
- Event sources not ready - allow manual entry/CSV.  
- Payment provider.  
- Legal complexity.  
- Upgrade race conditions mitigated by expiry, revalidation, idempotent delta capture.

## 14. Post-MVP backlog
- Advanced roles/delegation.  
- Client-initiated sharing.  
- Multi-payer upgrades.  
- Scheduled upgrades.

---

## Features list
(Features prioritized 1=highest)  

| Name | Short description | Priority |
|------|-------------------|----------|
| Client intake dialog | Validate inputs, create Client Request + COE draft | 1 |
| Client COE page | Mobile COE view, itinerary, accept, messaging, upgrades | 1 |
| Locations CRUD | CRUD with photos, geo, score | 1 |
| Events CRUD | CRUD with location, datetime, capacity, price | 1 |
| Assets library | Manage images, videos, seat assets | 1 |
| Sentiment rules | Influence recommendations | 1 |
| COE builder | Build itinerary, notes, policies | 1 |
| COE workflow statuses | Draft, approved, sent, accepted, rejected, expired | 1 |
| Approvals queue | Admins approve drafts | 1 |
| COE sharing link | Share COE with client | 1 |
| COE sharing: multi client * | Admin adds/removes clients from COE | 1 |
| COE participants list * | List owner and participants | 2 |
| Client accept and hold | Client accepts COE and pays deposit | 1 |
| Availability revalidation | Before capture and upgrades | 1 |
| Payments interface | Interface to The1 gateway | 1 |
| Payment capture | Capture funds | 1 |
| Refunds | Full/partial refund flow | 1 |
| Payment transactions log | Log holds, captures, refunds | 1 |
| Idempotency for payments | Avoid duplicates across retries | 1 |
| Webhook sandbox | Test gateway events | 1 |
| Audit log | Record all key actions | 1 |
| Analytics overview | Dashboard with COE/payment counts | 1 |
| Notifications | Push/SMS confirmations | 1 |
| Messaging thread | COE-scoped conversation | 1 |
| Authentication | Magic link (client), password+2FA (admin) | 1 |
| Authorization | Role-based access | 1 |
| Runner assignment | Assign/update runner, track status | 1 |
| Data model in MongoDB | Implement schema for all entities | 1 |
| Storage for media | S3-compatible | 1 |
| Admin UI | Builder, runner assignment, sharing | ? |
| API: client endpoints | Client COE APIs | 1 |
| API: admin endpoints | Admin COE APIs | 1 |
| Currency and totals | Compute totals in USD | 1 |
| Deploy to ECS Fargate | Container deploy | 1 |
| Observability | Logs, metrics | 1 |
| Upgrade creation | Admin/owner propose upgrades | 1 |
| Upgrade workflow | Pending/accepted/rejected | 1 |
| Upgrade delta payment | Capture delta payments | 1 |

---

## References
- [Excalidraw diagram](https://excalidraw.com/?utm_source=chatgpt.com#json=Amqu2N_cQGDz8VOlSCTas,CTHI0RMm1QPU6uif_p7a7A)  
- [Liv Nightclub Vegas](https://www.livnightclub.com/las-vegas/)  
- [Tao Group Events](https://taogroup.com/events/)  
- [Wynn Social Events](https://www.wynnsocial.com/events/?venue=xs)

