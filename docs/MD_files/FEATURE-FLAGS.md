# Feature Flags

## Overview

Feature flags allow enabling or disabling specific features in the application without code changes. This provides flexibility for gradual rollouts, A/B testing, or temporarily disabling features.

## Available Feature Flags

### `ENABLE_CLIENT_COE_CREATION`

**Purpose**: Controls whether clients can create their own COEs (Curated One Experiences).

**Environment Variable**: `ENABLE_CLIENT_COE_CREATION`

**Values**:
- `'true'` - Clients can create COEs for themselves
- `'false'` or missing - Clients cannot create COEs (admin-only)

**Default Behavior**: Disabled (clients cannot create COEs)

**When Disabled (`false` or missing)**:
- Clients cannot create COEs via bot (`create_coe_draft` tool)
- "Request Experience" button is hidden for clients in mobile app quick actions
- Admins are **not affected** - they can always create COEs

**When Enabled (`'true'`)**:
- Clients can create COEs for themselves via bot
- "Request Experience" button is visible for clients in mobile app
- Clients can submit COE creation requests through the bot conversation flow
- **Client-created COEs have status `'request'`** (awaiting admin review)
- Clients can view but cannot edit their request COEs until admin approves
- Clients can cancel their request COEs before approval

---

### `ENABLE_CLIENT_COE_EDITING`

**Purpose**: Controls whether clients can edit their own COEs (Curated One Experiences).

**Environment Variable**: `ENABLE_CLIENT_COE_EDITING`

**Values**:
- `'true'` - Clients can edit their own COEs
- `'false'` or missing - Clients cannot edit COEs (admin-only)

**Default Behavior**: Disabled (clients cannot edit COEs)

**When Disabled (`false` or missing)**:
- Clients cannot edit COEs via bot (`update_coe` tool)
- Clients cannot replace events in COEs (`PUT /v1/coes/:coeId/events/:oldEventId`)
- Clients cannot accept seat upgrades (`POST /v1/coes/:id/seat-upgrades/accept`)
- "Edit" action is hidden for clients in COE list screen
- All edit actions are disabled in COE detail screen:
  - "View Alternatives" button (for event replacement)
  - "Remove Event" button
  - "Edit Seat" button/functionality
  - "View Seat Upgrades" button
- Admins are **not affected** - they can always edit COEs

**When Enabled (`'true'`)**:
- Clients can edit their own COEs (if status is 'draft' or 'approved')
- Clients can replace events in their COEs
- Clients can accept seat upgrades
- All client-facing UI elements for COE editing are visible and functional

## Configuration

### Setting the Feature Flags

Add to `.env` file:

```bash
# Feature Flags: Client COE Creation and Editing
# Set to 'true' to enable the feature for clients
# Set to 'false' or omit to disable (admin-only)

# Enable/disable client COE creation (default: disabled)
ENABLE_CLIENT_COE_CREATION=false

# Enable/disable client COE editing (default: disabled)
ENABLE_CLIENT_COE_EDITING=false
```

### Changing the Feature Flags

1. Update the values in `.env` file
2. Restart the server to load the new environment variables
3. Mobile app will fetch updated flags on next app start or when AuthContext loads flags

**Note**: The flag values must be exactly `'true'` (lowercase string) to enable the feature. Any other value (including missing variable) will disable it.

### Configuration Examples

**Example 1: Clients can create but not edit**
```bash
ENABLE_CLIENT_COE_CREATION=true
ENABLE_CLIENT_COE_EDITING=false
```
- Clients can create new COEs
- Clients cannot edit existing COEs (including replacing events or seats)
- Admins handle all edits

**Example 2: Clients can edit but not create**
```bash
ENABLE_CLIENT_COE_CREATION=false
ENABLE_CLIENT_COE_EDITING=true
```
- Admins create COEs for clients
- Clients can edit COEs created for them (replace events, upgrade seats, etc.)

**Example 3: Clients can do both (full self-service)**
```bash
ENABLE_CLIENT_COE_CREATION=true
ENABLE_CLIENT_COE_EDITING=true
```
- Clients have full control over their COEs (create and edit)

**Example 4: Clients can do neither (admin-only)**
```bash
ENABLE_CLIENT_COE_CREATION=false
ENABLE_CLIENT_COE_EDITING=false
```
- All COE creation and editing is admin-only
- This is the default configuration

## Implementation Details

### Backend

**Files**:
- `server/utils/featureFlags.js` - Centralized feature flag utility functions
  - `isClientCOECreationEnabled()` - Checks creation flag
  - `isClientCOEEditingEnabled()` - Checks editing flag
- `server/services/botTools.js` - Conditionally includes 'client' in tool permissions
  - `create_coe_draft` tool uses `isClientCOECreationEnabled()`
  - `update_coe` tool uses `isClientCOEEditingEnabled()`
- `server/services/botToolHandlers.js` - Checks flags before allowing client actions
  - `handleCreateCOEDraft` checks creation flag
  - `handleUpdateCOE` checks editing flag
- `server/routes/coes.js` - Checks editing flag in event replacement and seat upgrade routes
  - `PUT /v1/coes/:coeId/events/:oldEventId` - Event replacement (uses editing flag)
  - `POST /v1/coes/:id/seat-upgrades/accept` - Seat upgrade acceptance (uses editing flag)
- `server/routes/features.js` - API endpoint to expose flags to mobile app

**Check Pattern**:
```javascript
// For creation
const { isClientCOECreationEnabled } = require('../utils/featureFlags');
if (user.role === 'client' && !isClientCOECreationEnabled()) {
  // Block client creation
}

// For editing
const { isClientCOEEditingEnabled } = require('../utils/featureFlags');
if (user.role === 'client' && !isClientCOEEditingEnabled()) {
  // Block client editing
}
```

### Mobile App

**Files**:
- `mobile/src/api/client.js` - `getFeatureFlags()` function
- `mobile/src/navigation/AuthContext.js` - Loads and stores feature flags in state
  - State: `{ enableClientCOECreation: false, enableClientCOEEditing: false }`
- `mobile/src/components/QuickActions.js` - Conditionally shows "Create Experience" button
  - Uses `enableClientCOECreation` prop
- `mobile/app/(tabs)/bot.js` - Passes creation flag to QuickActions component
- `mobile/app/(tabs)/index.js` - Conditionally shows "Edit" action in COE list
  - Uses `featureFlags?.enableClientCOEEditing` for Edit action visibility
- `mobile/app/coe-detail.js` - Conditionally enables/disables edit actions
  - Uses `featureFlags?.enableClientCOEEditing` for `canEdit` calculation
  - Controls visibility of: View Alternatives, Remove Event, Edit Seat, View Seat Upgrades

**Usage Pattern**:
```javascript
// In components
const {user, featureFlags} = useAuth();

// For creation permission
const canCreate = user?.role === 'admin' || 
                  (user?.role === 'client' && featureFlags?.enableClientCOECreation);

// For editing permission
const canEdit = user?.role === 'admin' || 
                (user?.role === 'client' && featureFlags?.enableClientCOEEditing);
```

## API Endpoint

### `GET /v1/features/flags`

Returns current feature flags (no authentication required).

**Response**:
```json
{
  "success": true,
  "data": {
    "enableClientCOECreation": false,
    "enableClientCOEEditing": false
  }
}
```

**Usage**: Mobile app calls this endpoint on startup to determine which features to enable/disable in the UI.

## Affected Functionality

### Creation Flag (`ENABLE_CLIENT_COE_CREATION`)

When disabled, clients **cannot**:
- Create COEs via bot (`create_coe_draft` tool)
- See "Create Experience" button in mobile app quick actions

When enabled, clients **can**:
- Create COEs for themselves via bot
- Use the COE preferences form to submit creation requests

### Editing Flag (`ENABLE_CLIENT_COE_EDITING`)

When disabled, clients **cannot**:
- Edit COEs via bot (`update_coe` tool)
- Replace events in COEs (`PUT /v1/coes/:coeId/events/:oldEventId`)
- Accept seat upgrades (`POST /v1/coes/:id/seat-upgrades/accept`)
- See "Edit" action in COE list screen
- See or use edit-related buttons in COE detail screen:
  - "View Alternatives" (for event replacement)
  - "Remove Event"
  - "Edit Seat"
  - "View Seat Upgrades"

When enabled, clients **can**:
- Edit their own COEs (if status is 'draft' or 'approved')
- Replace events in their COEs
- Accept seat upgrade offers
- Access all edit functionality in the UI

## Best Practices

1. **Default to Disabled**: Feature flags default to disabled (safe default)
2. **Independent Control**: Creation and editing are controlled separately for flexibility
3. **Clear Documentation**: Document what each flag controls and when to use it
4. **Environment-Specific**: Use different values for different environments (dev, staging, prod)
5. **Restart Required**: Server restart is required after changing flags
6. **Mobile Sync**: Mobile app syncs flags on startup, but may need app restart to reflect changes immediately
7. **UI Prevention**: UI elements are hidden/disabled to prevent user frustration from backend rejections

## Migration Notes

**Previous Implementation**: 
- Single flag `ENABLE_CLIENT_COE_MANAGEMENT` controlled both creation and editing
- Could not independently control creation vs editing

**Current Implementation**:
- Separate flags `ENABLE_CLIENT_COE_CREATION` and `ENABLE_CLIENT_COE_EDITING`
- Provides granular control over client permissions
- Allows different configurations (create only, edit only, both, neither)

## Future Feature Flags

As new features are added that may need to be conditionally enabled/disabled, they should:
- Follow the same pattern (utility function in `featureFlags.js`)
- Be exposed via `/v1/features/flags` endpoint
- Be documented in this file
- Use descriptive environment variable names
- Default to disabled for safety
