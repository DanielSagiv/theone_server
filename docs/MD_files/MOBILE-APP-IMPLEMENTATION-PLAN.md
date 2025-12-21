# THE1 Platform - Mobile App Implementation Plan

**Document Created:** December 17, 2025  
**Last Updated:** December 20, 2025  
**Purpose:** Actionable implementation plan for mobile app development

---

## Plan Overview

| Metric | Value |
|--------|-------|
| **Backend Readiness** | ~90% |
| **Total Phases** | 5 |
| **Estimated Timeline** | 6-8 weeks |
| **Platforms** | iOS (first), then Android (Expo) |
| **Blocking Backend Tasks** | 2 (Password Reset, COE Accept/Reject) |

### Key Design Constraints

**1. Concierge Model (No Catalog Browsing)**

Clients do NOT browse events/locations directly. Instead:
- **Admin-created COEs:** Admins curate experiences and send them to clients
- **Client-created COEs (via Bot):** Clients use the AI bot to create COEs; the system automatically calculates optimal events and seats based on preferences

Once a COE exists (regardless of who created it), clients can:
- View alternative events for each event in the COE
- View seat/table upgrade options
- Replace events or accept upgrades

All event/location access is contextual within a COE.

**2. Agent Interface with Cards**

The mobile app is an **AI agent interface** - not a traditional app with menus and screens. Users interact primarily through:
- **Conversational chat** with the AI agent
- **Rich cards** that display structured data (events, COEs, locations, profiles)
- **Action buttons** embedded in cards for quick interactions
- **Contextual responses** that remember conversation history

This card-based approach enables easy, intuitive usage without complex navigation.

**3. Dark Theme with Premium Color Palette**

The app uses a **dark style** with the following color palette:

| Color | Primary | Alternative | Usage |
|-------|---------|-------------|-------|
| **Gold** | `#D4AF37` | `#C9A86A` | Accents, CTAs, highlights, premium elements |
| **Black** | `#000000` | `#0D0D0D` | Backgrounds, primary surfaces |
| **Cream** | `#F4EDE2` | - | Text, light accents, contrast elements |
| **Emerald** | `#006F57` | `#014036` | Success states, secondary accents |

```
Background:     #0D0D0D (soft black)
Cards:          #1A1A1A or #141414
Primary Text:   #F4EDE2 (cream)
Secondary Text: #A0A0A0 (muted)
Accent:         #D4AF37 (gold)
Success:        #006F57 (emerald)
```

**4. Clean Interface Guidelines**

When designing the interface:
- **Avoid too many lines** - Minimize dividers, borders, and visual separators; use spacing and color contrast instead
- **Keep elements aligned** - Consistent alignment grid, uniform margins, predictable layout patterns

**5. Design Excellence Without Compromising Functionality**

While the mobile app reflects the bot's existing functionality, we prioritize:
- **Beautiful, modern UI** - Premium aesthetic matching THE1 brand (luxury concierge)
- **Intuitive UX** - Easy navigation, clear visual hierarchy, smooth animations
- **Polished interactions** - Micro-interactions, loading states, transitions
- **Usability first** - Clean layouts, readable typography, accessible design

**Principle:** Enhance the experience through design without adding features or changing core bot functionality. The app should feel premium and delightful while doing exactly what the bot does today.

**6. Expo Development Framework**

The mobile app will be built using **Expo** (React Native framework) for faster development and easier deployment:
- **Framework**: Expo (React Native with managed workflow)
- **Development Tool**: Expo Go for rapid testing and iteration
- **Deployment**: Expo Application Services (EAS) for building and deploying
- **Platform Priority**: iOS first, then Android (sequential development)
- **Project Location**: Mobile project will be created as a **separate repository** parallel to the server:
  ```
  THEONE/
  ├── server/          # Backend (separate git repo)
  └── mobile/          # Mobile app (separate git repo)
  ```
- **Package Management**: Always use latest stable versions of all packages, libraries, and dependencies (as of December 20, 2025)
- **Platform-Specific Considerations**:
  - Push notifications: Expo Notifications (FCM for Android, APNs for iOS)
  - Secure storage: Expo SecureStore (iOS Keychain, Android Keystore)
  - **iOS Glass Style**: iOS will use the new glass appearance style (glassmorphism) for cards, overlays, and UI elements
  - **Android Style**: Android will use simpler dark backgrounds with subtle transparency (no glass effect)
  - Platform-specific UI: React Native components with platform-specific styling when needed
  - Testing: iOS tested first, then Android (sequential approach)

**7. iOS Glass Style Implementation**

The iOS platform will utilize **glassmorphism** (glass appearance) to create a modern, premium aesthetic:

- **Glass Cards**: All card components (COE cards, event cards, profile cards) will use semi-transparent backgrounds with blur effects on iOS
- **Glass Overlays**: Modals, sheets, and overlays will use glass styling with appropriate blur and transparency
- **Implementation**:
  - Use Expo-compatible blur library (e.g., `expo-blur` or `@react-native-community/blur` if compatible with Expo)
  - Base styles defined in `src/theme/iosGlassStyles.js` with `iosGlassCard` and `iosGlassOverlay` styles
  - Semi-transparent dark backgrounds (`rgba(10, 20, 25, 0.65-0.75)`) with gold accent borders
  - BlurView wrapper for iOS components to achieve the glass effect
  - Ensure library is latest stable version and Expo-compatible (as of December 20, 2025)
- **Android Fallback**: Android will use solid dark backgrounds (`rgba(10, 20, 25, 0.9)`) with the same gold accents but without blur effects
- **Platform Detection**: Use `Platform.OS === 'ios'` to conditionally apply glass styles

**Note**: The glass style enhances the premium luxury feel on iOS while maintaining the same dark theme and color palette across both platforms.

---

## Bot Capabilities (Core Mobile Functionality)

The mobile app uses the **same backend APIs and services** as the web application. Users can interact with the platform through:
- **Conversational bot API** (`POST /v1/bot/message`) for natural language interactions
- **Direct REST API calls** for structured operations (COE management, payments, etc.)

All functionality leverages the same backend logic, services, and data models.

### Bot Tools (AI Function Calling)

| # | Tool | Description | Client | Admin | Runner |
|---|------|-------------|:------:|:-----:|:------:|
| 1 | `get_events_by_date` | Query events by date range with filters (location, type, search) | ✅ | ✅ | ✅ |
| 2 | `create_coe_draft` | Create COE with AI-optimized event/seat selection | ✅ | ✅ | |
| 3 | `update_coe` | Edit existing COE (events, seats, dates, notes) | ✅ | ✅ | |
| 4 | `get_my_coes` | List all user's COEs with status filtering | ✅ | ✅ | ✅ |
| 5 | `get_coe_details` | Get full COE details (events, seats, pricing, runner) | ✅ | ✅ | ✅ |
| 6 | `delete_coe` | Delete/cancel a COE | ✅ | ✅ | |
| 7 | `get_locations` | Query locations (venues, restaurants, hotels, clubs) | ✅ | ✅ | ✅ |
| 8 | `get_user_profile` | View user profile (own or others for admin/runner) | ✅ | ✅ | ✅ |
| 9 | `get_clients` | Search and list clients by name/email | | ✅ | ✅ |
| 10 | `open_create_coe_for_client` | Open COE creation form for a specific client | | ✅ | |

### COE Management Features (API + Bot Context)

| Feature | Description | Client | Admin |
|---------|-------------|:------:|:-----:|
| **Event Alternatives** | View alternative events within same city/date range | ✅ | ✅ |
| **Replace Event** | Swap an event in COE with an alternative | ✅ | ✅ |
| **Remove Event** | Remove an event from COE | ✅ | ✅ |
| **Seat/Table Upgrades** | View upgrade options for seats/tables | ✅ | ✅ |
| **Accept Upgrade** | Accept a seat/table upgrade offer | ✅ | ✅ |
| **Runner Assignment** | Assign a runner to COE (COE-level or event-level) | | ✅ |
| **COE Accept** | Accept a sent COE | ✅ | |
| **COE Reject** | Reject a sent COE with reason | ✅ | |

### AI-Powered Features (within `create_coe_draft`)

| Feature | Description |
|---------|-------------|
| **Smart Event Selection** | AI picks optimal events based on dates, city, user preferences |
| **Sentiment-Based Seat Matching** | Selects seats matching user sentiment (intimate, energetic, etc.) |
| **Budget Optimization** | Stays within budget while maximizing experience quality |
| **One Event Per Day** | Ensures no double-booking of dates |
| **Availability Check** | Only selects events with available seats |
| **Auto Price Calculation** | Calculates subtotal, taxes (30%), fees, total, deposit (20%) |

### Natural Language Understanding

The bot understands and converts:

| Input Type | Examples | Conversion |
|------------|----------|------------|
| **Dates** | "next 10 days", "next week", "December 15-20" | ISO 8601 format |
| **Budget** | "$5000", "budget of 8000", "max 10k" | `preferences.budget_range.max` |
| **Party Size** | "8 people", "party of 4", "just me" | `preferences.party_size` |
| **Location** | "Miami", "Las Vegas", "NYC" | `preferences.location_preferences` |
| **Vibe/Sentiment** | "intimate vibe", "energetic atmosphere" | `preferences.notes` |
| **COE Context** | "the COE we just created", "update it" | Uses `active_coe_id` from context |

### Bot API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /v1/bot/conversation` | GET | Get conversation history |
| `POST /v1/bot/message` | POST | Send message to bot (rate limited) |

**Rate Limiting:** Per-user + per-IP to prevent abuse.

### Mobile Bot Integration Strategy

The mobile app supports two interaction modes:

1. **Chat-First Interface**: Primary screen is a chat interface using the bot API (`POST /v1/bot/message`)
2. **Direct API Access**: Users can also interact directly via REST APIs for structured operations
3. **Structured Responses**: Bot returns structured data (events, COEs, locations) that mobile renders as cards/lists
4. **Action Buttons**: Bot responses include action buttons (e.g., "Create COE", "View Details", "Accept")
5. **Deep Linking**: Bot responses can link to specific screens (COE detail, payment, etc.)
6. **Context Preservation**: Bot maintains conversation context across sessions

### Example Flows (Bot + Card Actions)

**1. Client Creates COE via Bot (Conversational):**
```
User: "I want to plan a trip to Miami for 4 people, December 15-20, budget $8000"
Bot: [Uses create_coe_draft tool with AI optimization]
     → Returns COE card with events, seats, pricing
     → Card Actions: [View Details] [Edit] [Delete]
```

**2. Client Replaces Event (Card Action - NOT conversational):**
```
1. COE card shows events
2. Each event has [Remove] and [Replace] buttons (if alternatives exist)
3. User taps [Replace] on an event
4. App calls: GET /v1/coes/:coeId/events/:eventId/alternatives
5. → Returns list of alternative event cards
6. → Each card has: [Replace with This] button
7. User taps [Replace with This]
8. App calls: PUT /v1/coes/:coeId/events/:oldEventId
9. → COE updated with new event
```

**3. Client Views Seat/Table Upgrades (Carousel/Slides - NOT button):**
```
1. COE card shows events with seats/tables section
2. Seats are displayed in a CAROUSEL (swipeable slides)
3. User swipes through slides to see:
   - Current selected seats
   - Upgrade options (with price difference)
4. Each upgrade slide has: [Upgrade to This Seat] button
5. User taps [Upgrade to This Seat]
6. App calls: POST /v1/coes/:coeId/seat-upgrades/accept
7. → COE updated with new seat
```

**4. Admin Creates COE for Client (Conversational):**
```
Admin: "Create a COE for John Smith"
Bot: [Uses get_clients tool to find John]
     → Returns client profile card
     → Card Action: [Create COE for John]
Admin: [Taps button]
Bot: [Uses open_create_coe_for_client tool]
     → Opens COE creation form with client pre-selected
```

**5. Client Accepts/Rejects COE (TODO - Not Yet Implemented):**
```
1. COE card shows status: "Sent" with [Accept] [Reject] buttons
2. User taps [Accept]
3. App calls: POST /v1/coes/:id/accept
4. → COE status updated to "Accepted"
5. → Card now shows [Make Payment] button

NOTE: Accept/Reject buttons and API endpoints need to be implemented.
```

### Current COE Card Actions

| Action | Button/UI | When Visible | Status |
|--------|-----------|--------------|--------|
| View Details | Button | Always | ✅ Working |
| Edit | Button | Draft/Approved | ✅ Working |
| Delete | Button | Draft/Approved | ✅ Working |
| Approve | Button | Admin, Draft | ✅ Working |
| Cancel | Button | Draft | ✅ Working |
| Send to Client | Button | Admin, Approved | ✅ Working |
| Assign Runner | Button | Admin, Draft | ✅ Working |
| Remove Event | Button on event | Draft | ✅ Working |
| Replace Event | Button on event | Draft (if alternatives exist) | ✅ Working |
| Seat Upgrades | Carousel slides | Draft | ✅ Working |
| Accept COE | Button | Sent status | ❌ TODO |
| Reject COE | Button | Sent status | ❌ TODO |
| Make Payment | Button | Accepted status | ❌ TODO |

### What's Conversational vs. Card/UI Actions

| Feature | Conversational (Bot Tool) | Card/UI Action |
|---------|:-------------------------:|:--------------:|
| Create COE | ✅ `create_coe_draft` | - |
| View my COEs | ✅ `get_my_coes` | - |
| View COE details | ✅ `get_coe_details` | - |
| Update COE | ✅ `update_coe` | - |
| Delete COE | ✅ `delete_coe` | ✅ Button |
| View events by date | ✅ `get_events_by_date` | - |
| View locations | ✅ `get_locations` | - |
| View profile | ✅ `get_user_profile` | - |
| Search clients | ✅ `get_clients` (admin) | - |
| Remove event from COE | ❌ | ✅ Button |
| Replace event | ❌ | ✅ Button → API |
| View seat upgrades | ❌ | ✅ Carousel slides |
| Accept seat upgrade | ❌ | ✅ Button on slide |
| Accept/Reject COE | ❌ | ❌ TODO |
| Make payment | ❌ | ❌ TODO |

---

## Phase 0: Pre-Development Setup (Week 1)

**Goal:** Ensure development environment and tooling are ready.

### Tasks

| # | Task | Owner | Effort | Priority |
|---|------|-------|--------|----------|
| 0.1 | Set up Expo project (iOS first) parallel to `server/` directory | Mobile | 2-4 hrs | P0 |
| 0.2 | Configure Expo Go for development and testing | Mobile | 1 hr | P0 |
| 0.3 | Configure API base URL + environment switching | Mobile | 1 hr | P0 |
| 0.4 | Implement secure token storage (Expo SecureStore) | Mobile | 2-3 hrs | P0 |
| 0.5 | Create API client wrapper with auth headers | Mobile | 2-3 hrs | P0 |
| 0.6 | Set up error handling for API responses | Mobile | 2 hrs | P0 |
| 0.7 | Configure EAS Build for iOS deployment | Mobile | 1-2 hrs | P1 |

### Project Structure

```
THEONE/
├── server/              # Backend (separate git repository)
│   ├── routes/          # Backend API routes
│   ├── services/        # Backend services
│   └── ...
└── mobile/              # Mobile app (separate git repository)
    ├── app/             # Expo app directory (App Router)
    ├── src/             # Source code
    ├── assets/          # Images, fonts, etc.
    ├── app.json         # Expo configuration
    └── package.json     # Dependencies (latest stable as of Dec 20, 2025)
```

**Note:** The mobile project is a **separate repository** parallel to the server, allowing independent version control, deployment, and team workflows.

### Acceptance Criteria
- [ ] Expo project initialized parallel to `server/` directory (separate git repo)
- [ ] Project runs in Expo Go on iOS simulator/device
- [ ] Expo Go setup configured for rapid development iteration
- [ ] Mobile app connects to backend API
- [ ] JWT tokens stored securely using Expo SecureStore
- [ ] All API calls include `Authorization: Bearer <token>` header
- [ ] Error responses handled gracefully
- [ ] All packages are latest stable versions (as of December 20, 2025)
- [ ] EAS Build configured for iOS deployment (optional for Phase 0)

---

## Phase 1: Authentication & Profile (Week 1-2)

**Goal:** Users can sign up, log in, and manage their profile.

### Backend Tasks (All Ready - No Work Needed)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `POST /v1/auth/signup` | ✅ Ready | |
| `POST /v1/auth/signin` | ✅ Ready | Returns JWT + user |
| `POST /v1/auth/logout` | ✅ Ready | |
| `POST /v1/auth/verify-email` | ✅ Ready | |
| `POST /v1/auth/resend-verification` | ✅ Ready | |
| `GET /v1/auth/validate` | ✅ Ready | Session check |
| `GET /v1/users/profile` | ✅ Ready | |
| `PUT /v1/users/profile` | ✅ Ready | |
| `POST /v1/users/profile/avatar` | ✅ Ready | 50MB max |

### Backend Tasks (Need Implementation)

| # | Task | Endpoint | Effort | Priority |
|---|------|----------|--------|----------|
| 1.1 | Implement password reset request | `POST /v1/auth/forgot-password` | 2 hrs | P1 |
| 1.2 | Implement password reset with token | `POST /v1/auth/reset-password` | 2 hrs | P1 |

#### Implementation Details - Password Reset

**1.1 Forgot Password (`POST /v1/auth/forgot-password`)**

```javascript
// Request
{ "email": "user@example.com" }

// Response (always 200, even if email not found - security)
{ "success": true, "message": "If email exists, reset link sent" }

// Backend Logic:
// 1. Generate secure token (crypto.randomBytes)
// 2. Store token with expiry (1 hour) in User model
// 3. Send email with reset link (email service exists)
```

**1.2 Reset Password (`POST /v1/auth/reset-password`)**

```javascript
// Request
{ "token": "reset_token", "password": "new_password" }

// Response
{ "success": true, "message": "Password reset successful" }

// Backend Logic:
// 1. Validate token exists and not expired
// 2. Hash new password
// 3. Update user, clear token
// 4. Optionally invalidate existing sessions
```

### Mobile Tasks

| # | Task | Screens | Effort | Priority |
|---|------|---------|--------|----------|
| 1.3 | Login screen | Login | 4-6 hrs | P0 |
| 1.4 | Registration screen | Register | 4-6 hrs | P0 |
| 1.5 | Email verification screen | Verify | 2-3 hrs | P0 |
| 1.6 | Forgot password screen | ForgotPwd | 2-3 hrs | P1 |
| 1.7 | Reset password screen | ResetPwd | 2-3 hrs | P1 |
| 1.8 | Profile view/edit screen | Profile | 4-6 hrs | P0 |
| 1.9 | Avatar upload | Profile | 2-3 hrs | P1 |
| 1.10 | Session persistence (app restart) | - | 2 hrs | P0 |

### Acceptance Criteria
- [ ] User can register with email
- [ ] User can verify email
- [ ] User can log in
- [ ] User can reset password
- [ ] User can view/edit profile
- [ ] User can change avatar
- [ ] Session persists across app restarts
- [ ] Session validates on app launch

---

## Phase 2: COE Viewing & Interaction (Week 2-3)

**Goal:** Clients can view their COEs and interact with them.

### Backend Tasks (All Ready - No Work Needed)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /v1/coes/my` | ✅ Ready | List user's COEs |
| `GET /v1/coes/my/:id` | ✅ Ready | COE detail with events/seats |
| `GET /v1/coes/:coeId/events/:eventId/alternatives` | ✅ Ready | Alternative events |
| `PUT /v1/coes/:coeId/events/:oldEventId` | ✅ Ready | Replace event |
| `DELETE /v1/coes/:coeId/events` | ✅ Ready | Remove events |
| `POST /v1/coes/:id/seat-upgrades/accept` | ✅ Ready | Accept upgrade |

### Backend Tasks (Need Implementation)

| # | Task | Endpoint | Effort | Priority |
|---|------|----------|--------|----------|
| 2.1 | Implement COE accept | `POST /v1/coes/:id/accept` | 2 hrs | P0 |
| 2.2 | Implement COE reject | `POST /v1/coes/:id/reject` | 2 hrs | P0 |

#### Implementation Details - COE Accept/Reject

**2.1 Accept COE (`POST /v1/coes/:id/accept`)**

```javascript
// Request (optional note)
{ "note": "Looks great!" }

// Response
{ 
  "success": true, 
  "data": { /* updated COE */ },
  "message": "COE accepted" 
}

// Backend Logic:
// 1. Validate COE exists and belongs to user
// 2. Validate status is 'sent'
// 3. Update status to 'accepted'
// 4. Set accepted_date
// 5. Update seat statuses to 'held'
// 6. (Future) Trigger notification to admin
```

**2.2 Reject COE (`POST /v1/coes/:id/reject`)**

```javascript
// Request
{ "reason": "Too expensive" }

// Response
{ 
  "success": true, 
  "data": { /* updated COE */ },
  "message": "COE rejected" 
}

// Backend Logic:
// 1. Validate COE exists and belongs to user
// 2. Validate status is 'sent'
// 3. Update status to 'rejected'
// 4. Store rejection reason
// 5. Release any held seats
// 6. (Future) Trigger notification to admin
```

### Mobile Tasks

| # | Task | Screens | Effort | Priority |
|---|------|---------|--------|----------|
| 2.3 | COE list screen (home) | My COEs | 4-6 hrs | P0 |
| 2.4 | COE detail screen | COE Detail | 6-8 hrs | P0 |
| 2.5 | Event card component | - | 2-3 hrs | P0 |
| 2.6 | Seat/table display | - | 2-3 hrs | P0 |
| 2.7 | Accept COE flow | COE Detail | 2-3 hrs | P0 |
| 2.8 | Reject COE flow | COE Detail | 2-3 hrs | P0 |
| 2.9 | Event alternatives view | Alternatives | 4-6 hrs | P1 |
| 2.10 | Replace event flow | Alternatives | 2-3 hrs | P1 |
| 2.11 | Seat upgrade options view | Upgrades | 4-6 hrs | P1 |
| 2.12 | Accept upgrade flow | Upgrades | 2-3 hrs | P1 |
| 2.13 | Pull-to-refresh on lists | - | 1 hr | P1 |

### COE Status Display Guide

| Status | Color | Client Action |
|--------|-------|---------------|
| `draft` | Gray | *(Admin only)* |
| `approved` | Gray | *(Admin only)* |
| `sent` | Blue | Accept / Reject |
| `accepted` | Green | Make Payment |
| `rejected` | Red | *(Read only)* |
| `expired` | Orange | *(Read only)* |
| `completed` | Green | *(Read only)* |
| `cancelled` | Red | *(Read only)* |

#### Status Badge Design Specifications

Status badges use solid background colors with white text, borders, and uppercase styling for clear visual distinction:

| Status | Background Color | Text Color | Border Color | Notes |
|--------|------------------|------------|--------------|-------|
| `draft` | `#2C3E50` (Dark gray) | `#ECF0F1` (Light gray) | `#34495E` | Admin only |
| `approved` | `#27AE60` (Bright green) | `#FFFFFF` (White) | `#229954` | Admin only |
| `sent` | `#3498DB` (Blue) | `#FFFFFF` (White) | `#2980B9` | Accept / Reject |
| `accepted` | `#006F57` (Green) | `#FFFFFF` (White) | `#014036` | Make Payment |
| `rejected` | `#E74C3C` (Red) | `#FFFFFF` (White) | `#C0392B` | Read only |
| `expired` | `#F39C12` (Orange) | `#FFFFFF` (White) | `#E67E22` | Read only |
| `completed` | `#006F57` (Green) | `#FFFFFF` (White) | `#014036` | Read only |
| `cancelled` | `#E74C3C` (Red) | `#FFFFFF` (White) | `#C0392B` | Read only |

**Badge Styling:**
- Padding: `10px horizontal, 5px vertical`
- Border radius: `12px`
- Border width: `1px`
- Minimum width: `60px`
- Font: `11px, weight 700, uppercase, letter-spacing 0.5px`
- Alignment: Centered text with flex layout

### COE Status Transitions (Reference)

```
draft → approved → sent → accepted → completed
                      ↓         ↓
                  rejected   cancelled
                      ↓
                  expired
```

### Acceptance Criteria
- [ ] User sees list of their COEs
- [ ] User can view COE details with events/seats
- [ ] User can accept a COE (status: sent)
- [ ] User can reject a COE with reason
- [ ] User can view event alternatives
- [ ] User can replace an event
- [ ] User can view seat upgrade options
- [ ] User can accept a seat upgrade
- [ ] Lists refresh on pull-down

---

## Phase 3: Payments (Week 3-4)

**Goal:** Users can manage payment methods and pay for COEs.

### Backend Tasks (All Ready - No Work Needed)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /v1/payments/saved-cards` | ✅ Ready | List saved cards |
| `POST /v1/payments/tokenize` | ✅ Ready | Add card |
| `DELETE /v1/payments/saved-cards/:tokenId` | ✅ Ready | Remove card |
| `PUT /v1/payments/saved-cards/:tokenId/default` | ✅ Ready | Set default |
| `POST /v1/payments/saved-card/:tokenId/charge` | ✅ Ready | Charge card |
| `POST /v1/coes/:id/payments/full` | ✅ Ready | Pay for COE |
| `GET /v1/coes/:id/payments/status` | ✅ Ready | Payment status |
| `GET /v1/payments/:paymentId` | ✅ Ready | Payment details |

### Mobile Tasks

| # | Task | Screens | Effort | Priority |
|---|------|---------|--------|----------|
| 3.1 | Saved cards list screen | Cards | 4-6 hrs | P0 |
| 3.2 | Add card screen (with validation) | Add Card | 6-8 hrs | P0 |
| 3.3 | Card input component | - | 4-6 hrs | P0 |
| 3.4 | Delete card flow | Cards | 1-2 hrs | P1 |
| 3.5 | Set default card | Cards | 1 hr | P1 |
| 3.6 | COE payment flow | COE Detail | 4-6 hrs | P0 |
| 3.7 | Payment confirmation screen | Payment | 2-3 hrs | P0 |
| 3.8 | Payment history on COE | COE Detail | 2-3 hrs | P1 |

### Payment Flow (Reference)

```
1. User accepts COE (status: accepted)
2. User views COE detail
3. User taps "Pay Now"
4. If no saved card: Add card first
5. Select card (or use default)
6. Confirm payment
7. POST /v1/coes/:id/payments/full
8. Show success/failure
9. COE payment_status updated
```

### Acceptance Criteria
- [ ] User can view saved cards
- [ ] User can add a new card
- [ ] User can remove a card
- [ ] User can set default card
- [ ] User can pay for accepted COE
- [ ] Payment success/failure shown
- [ ] Payment history visible on COE

---

## Phase 4: Bot Chat Interface & Subscriptions (Week 4-5)

**Goal:** Implement the core chat interface - a primary way users interact with THE1.

> **Note:** The bot chat interface is a key feature of the mobile app, allowing natural language interactions. Users can also interact directly via REST APIs for structured operations.

### Backend Tasks (All Ready - No Work Needed)

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /v1/bot/conversation` | ✅ Ready | Get history |
| `POST /v1/bot/message` | ✅ Ready | Send message (rate limited) |
| `GET /v1/subscriptions/pricing` | ✅ Ready | Public pricing |
| `GET /v1/subscriptions/my` | ✅ Ready | User subscriptions |
| `POST /v1/subscriptions` | ✅ Ready | Create subscription |
| `GET /v1/subscriptions/:id` | ✅ Ready | Subscription detail |
| `POST /v1/subscriptions/:id/cancel` | ✅ Ready | Cancel |
| `PUT /v1/subscriptions/:id/payment-method` | ✅ Ready | Update payment |

### Mobile Tasks - Bot Chat

| # | Task | Screens | Effort | Priority |
|---|------|---------|--------|----------|
| 4.1 | Chat screen (main interface) | Bot | 6-8 hrs | P0 |
| 4.2 | Text message bubble component | - | 2-3 hrs | P0 |
| 4.3 | Typing/loading indicator | Bot | 1-2 hrs | P1 |
| 4.4 | Load conversation history | Bot | 2 hrs | P0 |
| 4.5 | **Event card component** (bot response) | - | 3-4 hrs | P0 |
| 4.6 | **COE card component** (bot response) | - | 4-5 hrs | P0 |
| 4.7 | **Location card component** (bot response) | - | 2-3 hrs | P1 |
| 4.8 | **User/Client card component** (bot response) | - | 2-3 hrs | P1 |
| 4.9 | **Action buttons in bot responses** | - | 3-4 hrs | P0 |
| 4.10 | Deep link handling from bot actions | - | 2-3 hrs | P1 |

### Mobile Tasks - Subscriptions

| # | Task | Screens | Effort | Priority |
|---|------|---------|--------|----------|
| 4.11 | Subscription pricing screen | Subscription | 4-6 hrs | P1 |
| 4.12 | Current subscription status | Profile | 2-3 hrs | P1 |
| 4.13 | Subscribe flow | Subscription | 4-6 hrs | P1 |
| 4.14 | Cancel subscription flow | Subscription | 2-3 hrs | P2 |

### Bot Response Types & Rendering

The bot returns structured responses. Mobile must render each type:

| Response Type | Contains | Render As |
|---------------|----------|-----------|
| `text` | Plain text message | Chat bubble |
| `events` | Array of events | Scrollable event cards |
| `coe` | COE object with events/seats | COE detail card with actions |
| `coe_list` | Array of COEs | List of COE summary cards |
| `locations` | Array of locations | Scrollable location cards |
| `clients` | Array of client profiles | Client list with "Create COE" button |
| `user_profile` | User object | Profile card |
| `alternatives` | Alternative events for COE | Event cards with "Replace" button |
| `upgrades` | Seat upgrade options | Upgrade cards with price diff |

### Action Buttons in Bot Responses

| Context | Available Actions |
|---------|-------------------|
| **COE Created** | View Details, Accept Draft, Modify, Delete |
| **COE Detail** | Accept, Reject, Make Payment, View Alternatives |
| **Event in COE** | View Alternatives, Remove Event |
| **Alternative Event** | Replace Current, Keep Current |
| **Upgrade Option** | Accept Upgrade, Decline |
| **Client Selected** | Create COE for Client, View Profile |

### Acceptance Criteria
- [ ] User can chat with AI bot
- [ ] Conversation history loads on screen open
- [ ] Text messages render as bubbles
- [ ] **Event cards render with images and details**
- [ ] **COE cards render with events, pricing, status**
- [ ] **Location cards render with type and address**
- [ ] **Action buttons trigger appropriate flows**
- [ ] Deep links navigate to correct screens
- [ ] User can view subscription pricing
- [ ] User can subscribe
- [ ] User can view current subscription
- [ ] User can cancel subscription

---

## Phase 5: Push Notifications (Week 5-7)

**Goal:** Users receive real-time notifications for COE updates.

### Backend Tasks (Need Implementation)

| # | Task | Endpoint | Effort | Priority |
|---|------|----------|--------|----------|
| 5.1 | Create Notification model | - | 2 hrs | P1 |
| 5.2 | Push token registration | `POST /v1/users/push-token` | 2 hrs | P1 |
| 5.3 | Remove push token | `DELETE /v1/users/push-token` | 1 hr | P2 |
| 5.4 | Get notifications | `GET /v1/notifications` | 2 hrs | P1 |
| 5.5 | Mark notification read | `PUT /v1/notifications/:id/read` | 1 hr | P2 |
| 5.6 | FCM/APNs integration | - | 4-6 hrs | P1 |
| 5.7 | Trigger on COE status change | - | 2-3 hrs | P1 |
| 5.8 | Trigger on payment received | - | 1-2 hrs | P2 |

#### Implementation Details - Push Notifications

**Notification Model**

```javascript
// models/Notification.js
{
  _id: ObjectId,
  user_id: ObjectId (ref: User, indexed),
  type: 'coe_sent' | 'coe_accepted' | 'payment_received' | 'coe_expired',
  title: String,
  body: String,
  data: {
    coe_id: ObjectId,
    action: String
  },
  read: Boolean (default: false),
  sent: Boolean (default: false),
  created_at: Date,
  read_at: Date
}
```

**Push Token Registration**

```javascript
// POST /v1/users/push-token
// Request
{ 
  "token": "fcm_or_apns_token",
  "platform": "ios" | "android" 
}

// Response
{ "success": true }
```

### Mobile Tasks

| # | Task | Screens | Effort | Priority |
|---|------|---------|--------|----------|
| 5.9 | Request notification permission (Expo Notifications) | - | 2 hrs | P1 |
| 5.10 | Register push token on login (Expo Notifications - FCM for Android, APNs for iOS) | - | 2 hrs | P1 |
| 5.11 | Remove token on logout | - | 1 hr | P2 |
| 5.12 | Handle push notification tap (deep linking) | - | 2-3 hrs | P1 |
| 5.13 | In-app notification badge | - | 2 hrs | P2 |
| 5.14 | Notifications list screen | Notifications | 4-6 hrs | P2 |

### Notification Types

| Type | When Sent | Action on Tap |
|------|-----------|---------------|
| `coe_sent` | Admin sends COE | Open COE detail |
| `coe_expired` | COE expires | Open COE list |
| `payment_received` | Payment processed | Open COE detail |
| `coe_updated` | COE modified | Open COE detail |

### Acceptance Criteria
- [ ] App requests notification permission
- [ ] Push token registered on login
- [ ] Push token removed on logout
- [ ] Notifications received when COE status changes
- [ ] Tapping notification opens relevant screen
- [ ] Notification badge shows unread count
- [ ] User can view notification history

---

## Phase 6: Admin Features (Week 6-8) - Optional

**Goal:** Admins can manage COEs, events, and locations from mobile.

### Backend Tasks (All Ready - No Work Needed)

All admin endpoints already exist. See report for full list.

### Mobile Tasks

| # | Task | Screens | Effort | Priority |
|---|------|---------|--------|----------|
| 6.1 | All COEs list (admin) | COE List | 4-6 hrs | P2 |
| 6.2 | COE detail (admin view) | COE Detail | 4-6 hrs | P2 |
| 6.3 | Change COE status | COE Detail | 2-3 hrs | P2 |
| 6.4 | Assign runner | COE Detail | 3-4 hrs | P2 |
| 6.5 | Events list | Events | 4-6 hrs | P2 |
| 6.6 | Event detail | Event Detail | 4-6 hrs | P2 |
| 6.7 | Locations list | Locations | 4-6 hrs | P2 |
| 6.8 | Location detail | Location Detail | 4-6 hrs | P2 |
| 6.9 | Client lookup | Search | 4-6 hrs | P2 |

---

## Data Models Reference

### User (for mobile)

```javascript
{
  _id: ObjectId,
  email: String,
  firstName: String,
  lastName: String,
  phone: String,
  role: 'admin' | 'client' | 'runner',
  userTier: 'member' | 'vip' | 'elite',
  avatarUrl: String,
  emailVerified: Boolean,
  saved_payment_methods: [{
    token_id: String,
    card_brand: String,
    card_last_four: String,
    is_default: Boolean
  }]
}
```

### COE (for mobile)

```javascript
{
  _id: ObjectId,
  name: String,
  description: String,
  status: String,
  
  // Events
  events: [{
    event_id: { /* populated Event */ },
    event_date: Date,
    base_price: Number,
    total_price: Number,
    status: String
  }],
  
  // Seats
  selected_seats: [{
    seat_code: String,
    capacity: Number,
    event_price: Number,
    status: String
  }],
  
  // Financial
  currency: String,
  subtotal: Number,
  taxes: Number,
  total: Number,
  deposit_required: Number,
  payment_status: String,
  
  // Dates
  start_date: Date,
  end_date: Date,
  
  // Runner
  runner_assignment: {
    runner: { /* populated User */ },
    status: String
  },
  
  // Upgrades
  seat_upgrade_offers: [...]
}
```

---

## API Response Format

### Success

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

### Error

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### Common Error Codes

| Code | HTTP | Handle As |
|------|------|-----------|
| `VALIDATION_ERROR` | 400 | Show error message |
| `UNAUTHORIZED` | 401 | Redirect to login |
| `EMAIL_NOT_VERIFIED` | 403 | Show verification screen |
| `FORBIDDEN` | 403 | Show access denied |
| `NOT_FOUND` | 404 | Show not found |
| `RATE_LIMIT_EXCEEDED` | 429 | Show "try again later" |

---

## Timeline Summary

> **Recommendation:** Consider starting Phase 4 (Bot) earlier or in parallel with Phase 2, since the bot chat is a key user interface feature.

| Week | Phase | Focus | Backend Work |
|------|-------|-------|--------------|
| 1 | 0, 1 | Setup + Auth | Password reset (4 hrs) |
| 2 | 1, 2, **4** | Profile + COE List + **Bot Chat** | COE accept/reject (4 hrs) |
| 3 | 2, 4 | COE Detail + Bot Response Rendering | None |
| 4 | 3 | Payments | None |
| 5 | 4 | Bot Polish + Subscriptions | None |
| 6-7 | 5 | Push Notifications | Push system (12-16 hrs) |
| 8 | 6 | Admin (Optional) | None |

**Total Backend Effort:** ~20-24 hours  
**Mobile Development:** Can start immediately  
**Development Approach:** iOS first, then Android (sequential)

### Recommended Parallel Tracks

```
Track A (Core):     Auth → Bot Chat → Bot Response Cards → COE Actions
Track B (Support):  Profile → COE List/Detail → Payments → Subscriptions
Track C (Polish):   Push Notifications → Admin Features
```

---

## Dependencies

```
Phase 0 (Setup)
    ↓
Phase 1 (Auth)
    ↓
┌───────────────────────────────────┐
│  Phase 2 (COE)  ←→  Phase 4 (Bot) │  ← Can be developed in parallel
└───────────────────────────────────┘
    ↓
Phase 3 (Payments)
    ↓
Phase 5 (Push Notifications)
    ↓
Phase 6 (Admin - Optional)
```

- **Phase 1** requires Phase 0 (API client setup)
- **Phase 2 & 4** require Phase 1 (authentication) - **can be parallel**
- **Phase 3** requires Phase 2 (COE viewing) and ideally Phase 4 (bot can trigger payments)
- **Phase 5** requires core features (1-4)
- **Phase 6** is optional for MVP

### Why Phase 4 (Bot) Should Be Early

The bot chat interface is a **key feature** for:
- Creating COEs (AI optimization via natural language)
- Discovering events (date-based queries)
- Managing COEs (update, delete via conversation)
- Viewing alternatives and upgrades

The bot provides an intuitive conversational interface, while direct REST APIs are also available for structured operations.

---

## Success Criteria (MVP)

### Core Authentication
- [ ] User can register, verify email, login
- [ ] User can reset password
- [ ] User can view/edit profile
- [ ] Session persists across app restarts

### Bot Chat Interface
- [ ] User can chat with AI bot
- [ ] Bot can query events by date/location
- [ ] Bot can create COE with AI optimization
- [ ] Bot renders structured responses (events, COEs, locations)
- [ ] Action buttons in bot responses work correctly
- [ ] Conversation history persists

### COE Management (via Bot + Direct API)
- [ ] User can view their COEs
- [ ] User can view COE details (events, seats, pricing)
- [ ] User can view event alternatives
- [ ] User can replace events in COE
- [ ] User can view seat/table upgrade options
- [ ] User can accept upgrades
- [ ] User can accept/reject sent COEs

### Payments
- [ ] User can manage saved cards
- [ ] User can make payments for accepted COE

### Post-MVP (Incremental)
- [ ] User receives push notifications
- [ ] Admin features on mobile

---

## Related Documents

- `docs/MD_files/architecture/mvp.md` - MVP specification
- `docs/MD_files/ADMIN-FULL-ACCESS-COE-EDITING.md` - Admin COE editing
- `docs/MD_files/payment/PAYMENT-SYSTEM-COMPLETE.md` - Payment documentation
- `docs/MD_files/email/EMAIL-SERVICE-SETUP.md` - Email configuration

