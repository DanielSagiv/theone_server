# Bot Profile View Feature - Implementation Plan

## Overview

This document outlines the implementation plan for adding user profile viewing capability to the bot/AI system. Users can request to view their profile (or other users' profiles for admins/runners) through natural language prompts, and the system will display a structured profile card aligned with the current design system.

## Feature Description

### User Story
As a user, I want to view my profile information through the bot interface by asking "show me my profile" or similar prompts, so I can quickly access my account details without navigating to the dashboard.

### Key Requirements
1. **Flexible Language Detection**: Support various ways users might ask to see their profile
2. **Security**: Clients can only view their own profile; Admins and Runners can view other profiles
3. **Design Alignment**: Profile card must match existing bot UI design patterns
4. **Mobile-Ready**: Design must be responsive and suitable for future mobile app

## Security Requirements

### Access Control Rules
- **Clients**: Can only view their own profile (`/users/profile`)
- **Admins**: Can view any user's profile (`/users/:id/profile`)
- **Runners**: Can view any user's profile (`/users/:id/profile`)
- **Validation**: Backend must enforce these rules; frontend should handle gracefully

### Implementation Notes
- Use existing authentication middleware
- Validate user role before allowing profile access
- Return appropriate error messages for unauthorized access attempts
- Log profile access attempts for audit purposes

## Prompt Detection Strategy

### Phase 1: Pattern-Based Detection (Primary)
Detect common patterns for profile requests:
- "show me my profile"
- "my profile"
- "view my profile"
- "display my profile"
- "profile information"
- "my account"
- "account details"
- "user profile"
- "show profile"

### Phase 2: OpenAI-Enhanced Detection (Fallback)
If pattern matching doesn't work, use OpenAI to understand intent:
- Use OpenAI to classify if the prompt is requesting profile information
- Extract user ID if mentioned (for admins/runners)
- Handle variations like "what's my email?", "show my account", etc.

### Implementation Approach
1. Add a new rule in `botService.js` (similar to "who are you?" rule)
2. Check for profile-related patterns first (fast, no API call)
3. If no match, let OpenAI process the message with profile context
4. If OpenAI suggests profile intent, trigger profile display

## API Integration

### Existing Endpoints
The following endpoints already exist and can be reused:

1. **GET `/v1/users/profile`** (Own Profile)
   - Returns current user's profile
   - Available to all authenticated users
   - Uses `req.user.getProfile()`

2. **GET `/v1/users/:id/profile`** (Other User Profile)
   - Returns specific user's profile by ID
   - Requires admin role (`requireAdmin` middleware)
   - Available to admins and runners

### Data Structure
Profile data includes:
- `firstName`, `lastName`
- `email`
- `phone`
- `role` (admin, client, runner)
- `avatarUrl`
- `dateOfBirth`
- `industry`
- `userTier` (member, vip, elite)
- `entity_status`
- `visibilityStatus`
- `socialMedia` (facebook, linkedin, x)
- `createdAt`, `updatedAt`
- `lastLogin`

### Implementation Notes
- Use existing `makeApiRequest` utility in frontend
- Handle API errors gracefully
- Show loading state while fetching
- Cache profile data if needed (consider privacy)

## UI/UX Design

### Profile Card Design

#### Layout Structure
```
┌─────────────────────────────────────┐
│  Profile Card (bot-structured-card) │
├─────────────────────────────────────┤
│  [Avatar/Initials]  Name            │
│                     Role Badge       │
├─────────────────────────────────────┤
│  Contact Information                │
│  • Email: user@example.com          │
│  • Phone: +1 234 567 8900           │
├─────────────────────────────────────┤
│  Account Details                    │
│  • User Tier: VIP                   │
│  • Industry: Tech                   │
│  • Status: Active                   │
├─────────────────────────────────────┤
│  Additional Info                    │
│  • Member Since: Jan 2024           │
│  • Last Login: Today                │
└─────────────────────────────────────┘
```

#### Design Elements
1. **Card Container**: Use `.bot-structured-card` class (matches COE/Event cards)
2. **Header Section**: 
   - Avatar (image or initials) on left
   - Name and role badge on right
   - Similar to runner details card in COE drill-down
3. **Information Sections**:
   - Group related fields together
   - Use consistent spacing (15px gap)
   - Label-value pairs with proper alignment
4. **Status Badges**: 
   - Role badge (admin/client/runner)
   - User tier badge (member/vip/elite)
   - Entity status badge (live/suspended/pending)
5. **Responsive Design**:
   - Mobile-friendly layout
   - Proper text wrapping
   - Touch-friendly spacing

#### CSS Classes to Reuse
- `.bot-structured-card` - Main card container
- `.coe-runner-avatar` - Avatar styling (from COE runner details)
- `.coe-runner-name` - Name styling
- Status badge classes (`.coe-status-*`)
- `.profile-field` - Field layout (from dashboard modal)

#### New CSS Classes Needed
- `.bot-profile-card` - Profile card specific styles
- `.bot-profile-header` - Header section with avatar
- `.bot-profile-section` - Information section grouping
- `.bot-profile-field` - Individual field row
- `.bot-profile-badge` - Badge styling for role/tier/status

### Color Scheme
- Match existing dark theme
- Use same color palette as COE cards
- Status badges: green (active), yellow (pending), red (suspended)

## Implementation Phases

### Phase 1: Basic Profile View (Own Profile Only)
**Goal**: Allow users to view their own profile via bot prompt

**Tasks**:
1. Add pattern-based rule detection in `botService.js`
2. Create `formatProfileResponse` function in `botResponseFormatter.js`
3. Add `user_profile` to `isStructuredResponse` types
4. Create profile card rendering function in `dashboard.ejs`
5. Add CSS styling for profile card
6. Test with various prompts

**Deliverables**:
- Users can say "show me my profile" and see their profile card
- Profile card displays basic information (name, email, phone, role)
- Design matches existing bot UI

### Phase 2: Enhanced Detection & Other Profiles
**Goal**: Add OpenAI detection and support for admins/runners to view other profiles

**Tasks**:
1. Enhance prompt detection with OpenAI (if pattern matching fails)
2. Add user ID extraction from prompts (for admins/runners)
3. Create `get_user_profile` tool in `botTools.js`
4. Implement `handleGetUserProfile` in `botToolHandlers.js`
5. Add security validation (role-based access)
6. Update frontend to handle other user profiles
7. Add "View Profile" action for other users in relevant contexts

**Deliverables**:
- Admins/runners can view other users' profiles
- Flexible language detection works
- Security properly enforced

### Phase 3: Enhanced Profile Display
**Goal**: Show additional profile information and improve UX

**Tasks**:
1. Add social media links display
2. Show profile statistics (if available)
3. Add "Edit Profile" quick action button
4. Improve mobile responsiveness
5. Add profile image upload capability (if needed)

**Deliverables**:
- Complete profile information displayed
- Better mobile experience
- Quick actions available

### Phase 4: Client Search & Selection for Admins/Runners
**Goal**: Allow admins and runners to search and select clients to view their profiles

**Tasks**:
1. Detect client search requests from admins/runners
2. Create client list tool/endpoint to fetch clients with pagination
3. Display client list card with search functionality
4. Implement client card grid with avatar, name, and email
5. Add pagination controls
6. Add search box that filters by name and email
7. Add "View" button on each client card
8. Handle "View" button click to show selected client's profile

**Deliverables**:
- Admins/runners can search for clients by name or email
- Client list displayed in a card grid format
- Pagination for large client lists
- Search functionality filters results in real-time
- Clicking "View" displays the selected client's full profile card

**User Flows**:

1. **Own Profile Request (Admin/Runner)**:
   - Prompt: "show me my profile" or "my profile"
   - Result: Display own profile card (regular flow)

2. **Client Search Request (Admin/Runner)**:
   - Prompts:
     - "show me client <value>"
     - "im looking for a client profile"
     - "find client john"
     - "search for client with email john@example.com"
     - "show me clients"
     - Flexible language variations
   - Result: Display client list card with search and pagination

3. **Client Selection**:
   - User clicks "View" button on a client card
   - Result: Display selected client's full profile card

**Technical Requirements**:

- **Backend**:
  - New tool: `get_clients` or enhance `get_user_profile` to handle search
  - Endpoint to fetch clients with pagination (page, limit)
  - Search functionality: filter by name (firstName, lastName) and email
  - Return client list with: id, name, email, avatarUrl, role
  - Security: Only admins and runners can access

- **Frontend**:
  - New structured response type: `client_list`
  - Client list card component with:
    - Search input box (filters by name/email)
    - Client card grid (avatar, full name, email)
    - Pagination controls (Previous/Next, page numbers)
    - "View" button on each client card
  - Click handler: "View" button triggers `get_user_profile` with selected client's ID
  - Mobile-responsive grid layout

**UI/UX Design**:

- **Client List Card**:
  - Search box at top (full width, styled like other inputs)
  - Client cards in responsive grid (2-3 columns on desktop, 1 on mobile)
  - Each client card shows:
    - Avatar (image or initials)
    - Full name (firstName + lastName)
    - Email address
    - "View" button (professional styling, matches existing buttons)
  - Pagination at bottom (Previous, page numbers, Next)
  - Loading state while fetching
  - Empty state when no clients found

- **Styling**:
  - Match existing bot card designs
  - Use same color scheme and spacing
  - Professional "View" button with icon
  - Search box with clear/icon indicators

## Technical Implementation Details

### Backend Changes

#### 1. `services/botService.js`
Add new rule for profile detection:
```javascript
// Rule 3: Show my profile
const profilePatterns = [
  'show me my profile',
  'my profile',
  'view my profile',
  'display my profile',
  'profile information',
  'my account',
  'account details'
];

// Check if prompt matches profile request
// If match, fetch profile and return structured response
```

#### 2. `services/botTools.js`
Add new tool (Phase 2):
```javascript
get_user_profile: {
  name: 'get_user_profile',
  description: 'Get user profile information. Use when users ask to view a profile.',
  parameters: {
    type: 'object',
    properties: {
      user_id: {
        type: 'string',
        description: 'User ID (optional - defaults to current user)'
      }
    }
  },
  permissions: ['admin', 'client', 'runner'],
  handler: 'handleGetUserProfile'
}
```

#### 3. `services/botToolHandlers.js`
Implement handler:
```javascript
async function handleGetUserProfile(params, user) {
  // Security check: clients can only view own profile
  // Admins/runners can view any profile
  // Fetch profile from API
  // Return formatted response
}
```

#### 4. `services/botResponseFormatter.js`
Add formatter:
```javascript
function formatProfileResponse(user, message) {
  return {
    type: 'user_profile',
    message: message || 'Here is your profile information.',
    profile: {
      id: user._id,
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      phone: user.phone,
      role: user.role,
      avatarUrl: user.avatarUrl,
      // ... other fields
    }
  };
}
```

### Frontend Changes

#### 1. `views/test/dashboard.ejs`
Add rendering function:
```javascript
function renderProfileCard(profileData) {
  // Create card HTML
  // Use existing card structure
  // Match design patterns from COE cards
  // Display all profile information
}
```

Add to `renderBotMessages`:
```javascript
case 'user_profile':
  renderProfileCard(message.structured_data.profile);
  break;
```

#### 2. CSS Styling
Add new styles matching existing design:
```css
.bot-profile-card {
  /* Match .bot-structured-card styles */
}

.bot-profile-header {
  /* Avatar + name layout */
}

.bot-profile-section {
  /* Section grouping */
}
```

## Mobile App Considerations

### Design Principles
1. **Touch-Friendly**: Ensure buttons and interactive elements are at least 44x44px
2. **Readable Text**: Use appropriate font sizes (minimum 14px for body text)
3. **Responsive Layout**: Card should adapt to different screen widths
4. **Performance**: Minimize API calls, cache profile data when appropriate
5. **Offline Support**: Consider caching profile data for offline viewing

### Future Enhancements
- Profile editing through bot (Phase 3)
- Profile image upload
- Profile statistics/analytics
- Quick actions (edit, share, etc.)

## Testing Scenarios

### Test Cases

1. **Basic Profile View**
   - User: "show me my profile"
   - Expected: Profile card displayed with user's information

2. **Variations**
   - User: "my profile"
   - User: "view my account"
   - User: "what's my email?"
   - Expected: All should trigger profile display

3. **Security - Client**
   - Client tries: "show me profile of user X"
   - Expected: Error message or own profile only

4. **Security - Admin**
   - Admin: "show me profile of user X"
   - Expected: Other user's profile displayed

5. **Security - Runner**
   - Runner: "show me profile of user X"
   - Expected: Other user's profile displayed

6. **Error Handling**
   - Invalid user ID
   - Network error
   - Unauthorized access
   - Expected: Appropriate error messages

## Success Criteria

1. ✅ Users can view their profile via natural language prompts
2. ✅ Profile card matches existing bot UI design
3. ✅ Security rules properly enforced
4. ✅ Mobile-responsive design
5. ✅ Error handling works correctly
6. ✅ Performance is acceptable (< 2s load time)

## Dependencies

- Existing user profile API endpoints
- Authentication middleware
- Bot conversation system
- OpenAI API (for enhanced detection)
- Existing UI components and styles

## Timeline Estimate

- **Phase 1**: 2-3 days
- **Phase 2**: 2-3 days
- **Phase 3**: 1-2 days
- **Phase 4**: 2-3 days
- **Total**: 7-11 days

## Notes

- Reuse existing dashboard profile modal code where possible
- Maintain consistency with COE/Event card designs
- Consider adding profile editing in future phases
- Keep mobile app requirements in mind during design

