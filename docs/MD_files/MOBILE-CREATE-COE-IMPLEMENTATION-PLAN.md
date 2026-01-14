# Mobile Create COE Implementation Plan

## Overview
This document outlines the implementation plan for the Create COE (Curated One Experience) feature on the mobile app. The feature allows both **client** and **admin** users to create COEs through an intuitive, mobile-optimized interface integrated with the bot chat system.

**Note**: Client COE creation and editing can be controlled independently via feature flags:
- `ENABLE_CLIENT_COE_CREATION` - Controls client ability to create COEs
- `ENABLE_CLIENT_COE_EDITING` - Controls client ability to edit COEs

When disabled, clients cannot create or edit COEs (admin-only). See `FEATURE-FLAGS.md` for details.

---

## User Flows

### Client Flow
```
1. User clicks "Create Experience" quick action button
   ↓
2. Bot receives "build my experience" prompt
   ↓
3. Bot responds with `coe_preferences_form` structured data
   ↓
4. Mobile renders COEPreferencesForm component
   ↓
5. User fills form (City, Dates, Budget, Party Size, Preferences)
   ↓
6. User submits form
   ↓
7. Form data sent to bot as message
   ↓
8. Bot creates COE draft and responds with COE card
   ↓
9. User can view created COE
```

### Admin Flow
```
1. User clicks "Show me clients" quick action button
   ↓
2. Bot receives "show me clients" prompt
   ↓
3. Bot responds with `client_list` structured data
   ↓
4. Mobile renders list of ClientCard components
   ↓
5. Admin can:
   - Click "Create Experience" button on a client card
   - Click "View experiences" button to see all COEs for that client
   - Click "View Profile" button to view client profile
   ↓
6a. If "Create Experience" clicked:
    - Mobile sends bot message: "Open the create COE form for client with id {clientId}..."
    - Bot responds with `coe_create_form` structured data
    - Mobile renders COECreateForm component
    - Admin fills form (Dates, Budget, Party Size, Notes)
    - Admin submits form
    - Form data sent to bot as message
    - Bot creates COE draft for that client and responds with COE card
    - Admin can view created COE
   ↓
6b. If "View experiences" clicked:
    - Mobile navigates to `/client-coes` screen with clientId and clientName
    - Screen fetches all COEs for that client using `GET /v1/coes/client/:clientId`
    - Displays COEs with full event details (name, dates, images)
    - Admin can navigate to individual COE detail screens
```

---

## Mobile-Optimized Design & Flow Considerations

### Design Principles
1. **Progressive Disclosure**: Break complex forms into steps/sections to reduce cognitive load
2. **Touch-Friendly**: All interactive elements should be at least 44x44pt (iOS) / 48x48dp (Android)
3. **Contextual Help**: Provide inline hints and validation messages
4. **Smart Defaults**: Pre-fill known information (e.g., user's city from profile)
5. **Keyboard Optimization**: Show appropriate keyboard types (numeric, date, etc.)
6. **Visual Feedback**: Clear loading states, success/error messages
7. **Accessibility**: Support screen readers, proper labels, high contrast

### Mobile-Specific Improvements Over Web

#### 1. Form Layout
- **Web**: Single long form with all fields visible
- **Mobile**: Consider multi-step wizard or collapsible sections
  - Step 1: Basic Info (City, Dates, Budget, Party Size)
  - Step 2: Preferences (Seat Preferences, Specific Preferences)
  - Progress indicator at top
  - "Next" and "Back" buttons
  - Final "Submit" on last step

#### 2. Date Selection
- **Web**: Standard date input fields
- **Mobile**: Native date pickers (iOS/Android native components)
  - Better UX with calendar view
  - Automatic validation
  - Platform-consistent design

#### 3. City Selection
- **Web**: Dropdown select
- **Mobile**: Searchable list with autocomplete
  - Full-screen modal for better visibility
  - Search bar at top
  - Recent/popular cities section
  - Keyboard-friendly

#### 4. Budget Input
- **Web**: Simple number input
- **Mobile**: Enhanced with:
  - Currency symbol always visible
  - Slider option for quick selection (optional)
  - Suggested budget ranges (e.g., $1,000-$5,000)
  - Format as user types (e.g., "5000" → "$5,000")

#### 5. Party Size
- **Web**: Number input
- **Mobile**: Stepper component (+/- buttons)
  - Visual increment/decrement
  - Min/max validation
  - Quick presets (1, 2, 4, 6, 8+)

#### 6. Text Areas
- **Web**: Standard textarea
- **Mobile**: 
  - Character counter
  - Auto-expanding height
  - Placeholder hints with examples
  - Voice input option (optional)

#### 7. Form Validation
- **Web**: Submit-time validation
- **Mobile**: Real-time inline validation
  - Show errors as user types/leaves field
  - Green checkmarks for valid fields
  - Clear error messages below fields

#### 8. Submission Flow
- **Web**: Submit button at bottom
- **Mobile**: 
  - Floating action button (FAB) for submit
  - Sticky submit button that follows scroll
  - Confirmation dialog before submission
  - Success animation/confetti (optional)

#### 9. Client List (Admin)
- **Web**: Grid/list view
- **Mobile**: 
  - Swipeable cards
  - Pull-to-refresh
  - Search/filter bar
  - Infinite scroll or pagination

#### 10. Error Handling
- **Web**: Alert popups
- **Mobile**: 
  - Toast notifications (non-blocking)
  - Inline error messages
  - Retry buttons
  - Offline detection

---

## Implementation Tasks

### Phase 1: Reusable Components

#### 1.1 Create `DateRangePicker.js`
**Purpose**: Mobile-optimized date range selection

**Features**:
- Native date pickers (iOS/Android)
- Start date picker
- End date picker with min date = start date
- Visual calendar interface
- Date formatting (e.g., "Dec 20, 2025")
- Validation (end >= start)
- Error messages

**Design**:
- Card-based layout
- Clear labels
- Touch-friendly date selection
- Smooth animations

**Props**:
```javascript
{
  startDate: Date | null,
  endDate: Date | null,
  onStartDateChange: (date: Date) => void,
  onEndDateChange: (date: Date) => void,
  minDate?: Date,
  required?: boolean,
  error?: string,
}
```

#### 1.2 Create `CityPicker.js`
**Purpose**: Searchable city selection

**Features**:
- Full-screen modal picker
- Search/filter functionality
- Popular cities section
- Recent selections (localStorage)
- Keyboard-friendly
- Loading state for API calls

**Design**:
- Search bar at top
- List of cities with checkmarks
- Section headers (Popular, All Cities)
- Empty state when no results

**Props**:
```javascript
{
  selectedCity: string | null,
  onCitySelect: (city: string) => void,
  cities?: string[], // Optional: pre-loaded list
  required?: boolean,
  error?: string,
}
```

#### 1.3 Create `BudgetInput.js`
**Purpose**: Enhanced budget input with formatting

**Features**:
- Currency formatting ($ prefix)
- Number formatting (commas)
- Optional slider for quick selection
- Suggested ranges
- Min/max validation

**Design**:
- Large, clear input field
- Currency symbol always visible
- Helper text with examples
- Visual feedback

**Props**:
```javascript
{
  value: number | null,
  onChange: (value: number) => void,
  min?: number,
  max?: number,
  required?: boolean,
  error?: string,
  showSlider?: boolean,
}
```

#### 1.4 Create `PartySizeStepper.js`
**Purpose**: Visual party size selector

**Features**:
- Increment/decrement buttons
- Min/max limits
- Quick preset buttons (1, 2, 4, 6, 8+)
- Visual feedback

**Design**:
- Large +/- buttons
- Current value prominently displayed
- Preset chips below
- Touch-friendly

**Props**:
```javascript
{
  value: number,
  onChange: (value: number) => void,
  min?: number,
  max?: number,
  required?: boolean,
  error?: string,
}
```

---

### Phase 2: Form Components

#### 2.1 Create `COEPreferencesForm.js`
**Purpose**: Client preferences form for building experience

**Fields**:
1. **City** (required)
   - Component: `CityPicker`
   - Validation: Must select a city

2. **Date Range** (required)
   - Component: `DateRangePicker`
   - Validation: Start date in future, end >= start

3. **Budget** (required)
   - Component: `BudgetInput`
   - Validation: > 0, reasonable max

4. **Party Size** (required)
   - Component: `PartySizeStepper`
   - Validation: >= 1

5. **Seat Preferences** (optional)
   - Component: TextArea with character counter
   - Placeholder: "E.g., VIP table near the stage, private booth"

6. **Specific Preferences** (optional)
   - Component: TextArea with character counter
   - Placeholder: "E.g., EDM music, upscale atmosphere, birthday celebration"

**Design**:
- Multi-step wizard (2 steps):
  - **Step 1**: Basic Info (City, Dates, Budget, Party Size)
  - **Step 2**: Preferences (Seat, Specific)
- Progress indicator (1 of 2, 2 of 2)
- Card-based layout
- Dark theme with gold accents
- Smooth step transitions

**Form Submission**:
Format data as:
```
Build my experience with the following preferences:
City: {city}
Start date: {startDate}
End date: {endDate}
Budget: ${budget} USD
Number of people: {partySize}
Seat preferences: {seatPreferences}
Specific preferences: {specificPreferences}
```

**Props**:
```javascript
{
  onSubmit: (formData: COEPreferencesData) => void,
  onCancel?: () => void,
  initialData?: Partial<COEPreferencesData>,
}
```

#### 2.2 Create `COECreateForm.js`
**Purpose**: Admin COE creation form for specific client

**Fields**:
1. **Client Summary** (read-only)
   - Display: Client name, email, phone
   - Design: Card with avatar
   - Non-editable

2. **Date Range** (required)
   - Component: `DateRangePicker`
   - Validation: Start date in future, end >= start

3. **Budget** (optional)
   - Component: `BudgetInput`
   - Validation: > 0 if provided

4. **Party Size** (optional)
   - Component: `PartySizeStepper`
   - Validation: >= 1 if provided

5. **Notes** (optional)
   - Component: TextArea with character counter
   - Placeholder: "Any additional context or preferences for this client..."

**Design**:
- Single-step form (simpler than client form)
- Client info card at top
- Form fields below
- Card-based layout
- Dark theme with gold accents

**Form Submission**:
Format data as:
```
Create a COE draft using the following data:
Start date: {startDate}
End date: {endDate}
Budget: ${budget}
Number of people: {partySize}
Notes: {notes}
```

**Props**:
```javascript
{
  client: ClientData,
  onSubmit: (formData: COECreateData) => void,
  onCancel?: () => void,
  initialData?: Partial<COECreateData>,
}
```

---

### Phase 3: Integration

#### 3.1 Update `BotResponseRenderer.js`
**Add new cases**:

```javascript
case 'coe_preferences_form':
  return (
    <COEPreferencesForm
      onSubmit={handleFormSubmit}
      onCancel={handleFormCancel}
    />
  );

case 'coe_create_form':
  return (
    <COECreateForm
      client={structuredData.client}
      onSubmit={handleFormSubmit}
      onCancel={handleFormCancel}
    />
  );
```

**Handle form submission**:
- Format form data as message
- Call `onAction('submit_form', formattedData)`

#### 3.2 Update `bot.js` (Bot Chat Screen)
**Add to `handleAction`**:
```javascript
case 'create_coe':
  // Extract client ID and send bot message
  const clientId = data.id || data._id;
  handleSend(
    `Open the create COE form for client with id ${clientId}. Use the open_create_coe_for_client tool with this client_id.`
  );
  break;

case 'submit_form':
  // Format and send form data to bot
  handleSend(data.formattedMessage);
  break;
```

**Add form submission handler**:
- Receive form data from `BotResponseRenderer`
- Format as message string
- Send via `handleSend`
- Show loading state
- Handle success/error

#### 3.3 Verify `ClientCard.js`
- Ensure `onCreateCOE` prop is properly wired
- Verify button styling matches design
- Test touch target size (44x44pt minimum)

---

### Phase 4: Mobile UX Enhancements

#### 4.1 Loading States
- Show spinner during form submission
- Disable form inputs while submitting
- Show progress indicator for multi-step forms

#### 4.2 Success Feedback
- Success toast notification
- Smooth animation when COE card appears
- Optional: Confetti animation
- Auto-scroll to new COE card

#### 4.3 Error Handling
- Inline validation errors
- Network error toasts
- Bot error messages displayed clearly
- Retry mechanism for failed submissions

#### 4.4 Keyboard Management
- Auto-focus first field when form appears
- "Next" button on keyboard moves to next field
- "Done" button on last field
- Dismiss keyboard on scroll

#### 4.5 Accessibility
- Screen reader labels for all inputs
- High contrast mode support
- Voice input support (optional)
- Haptic feedback on button presses (iOS)

---

## Design Specifications

### Color Scheme
- **Background**: `colors.background` (dark)
- **Card Background**: `colors.cardBackground` (darker)
- **Primary Accent**: `colors.gold` (#D4AF37)
- **Text Primary**: `colors.textPrimary` (white/light)
- **Text Secondary**: `colors.textSecondary` (gray)
- **Border**: `colors.borderLight`
- **Error**: Red (#E74C3C)
- **Success**: Green (#27AE60)

### Typography
- **Headings**: `commonStyles.heading` (18-20px, bold)
- **Labels**: `commonStyles.bodySecondary` (14-16px)
- **Input Text**: `commonStyles.bodyPrimary` (16px)
- **Helper Text**: `commonStyles.caption` (12-14px, muted)

### Spacing
- **Card Padding**: 16px
- **Field Spacing**: 16px vertical
- **Input Padding**: 12-16px horizontal, 12px vertical
- **Button Padding**: 14px horizontal, 12px vertical

### Border Radius
- **Cards**: 12px
- **Inputs**: 8px
- **Buttons**: 8px

### Touch Targets
- **Minimum Size**: 44x44pt (iOS) / 48x48dp (Android)
- **Button Height**: 48px minimum
- **Input Height**: 48px minimum

---

## File Structure

```
mobile/
├── src/
│   ├── components/
│   │   ├── COEPreferencesForm.js      [NEW]
│   │   ├── COECreateForm.js            [NEW]
│   │   ├── DateRangePicker.js          [NEW]
│   │   ├── CityPicker.js               [NEW]
│   │   ├── BudgetInput.js              [NEW]
│   │   ├── PartySizeStepper.js         [NEW]
│   │   ├── BotResponseRenderer.js      [UPDATE]
│   │   └── ClientCard.js               [VERIFY]
│   └── ...
└── app/
    └── (tabs)/
        └── bot.js                       [UPDATE]
```

---

## Testing Checklist

### Client Flow
- [ ] Quick action "Create Experience" triggers bot
- [ ] Bot returns `coe_preferences_form`
- [ ] Form renders correctly with step indicator
- [ ] Step 1 fields validate properly
- [ ] Step 2 fields validate properly
- [ ] Navigation between steps works
- [ ] Form submission sends correct data
- [ ] Bot creates COE and responds with COE card
- [ ] Success feedback displays
- [ ] Error handling works

### Admin Flow
- [ ] Quick action "Show me clients" triggers bot
- [ ] Bot returns `client_list`
- [ ] Client cards render with "Create COE" buttons
- [ ] Clicking "Create COE" sends correct message
- [ ] Bot returns `coe_create_form`
- [ ] Form renders with client info
- [ ] All fields validate properly
- [ ] Form submission sends correct data
- [ ] Bot creates COE for client
- [ ] Success feedback displays
- [ ] Error handling works

### Mobile-Specific
- [ ] Touch targets are adequate size
- [ ] Keyboard management works correctly
- [ ] Date pickers use native components
- [ ] City picker modal is full-screen and searchable
- [ ] Budget formatting works correctly
- [ ] Party size stepper is intuitive
- [ ] Loading states display properly
- [ ] Error messages are clear and actionable
- [ ] Success animations are smooth
- [ ] Accessibility features work (screen readers, etc.)

---

## Implementation Order

1. **Create reusable components** (DateRangePicker, CityPicker, BudgetInput, PartySizeStepper)
2. **Create form components** (COEPreferencesForm, COECreateForm)
3. **Update BotResponseRenderer** to handle new form types
4. **Update bot.js** to handle form submissions
5. **Add mobile UX enhancements** (loading, success, errors)
6. **Test client flow** thoroughly
7. **Test admin flow** thoroughly
8. **Polish design and animations**
9. **Accessibility audit**
10. **Performance optimization**

---

## API Considerations

### City List
- Option 1: Fetch from API endpoint (if available)
- Option 2: Use predefined list of popular cities
- Option 3: Allow free-text input with autocomplete

### Form Submission
- Format as natural language message to bot
- Bot processes and calls appropriate tool (`create_coe_draft`)
- No direct API calls from mobile app

---

## Future Enhancements

1. **Save Draft**: Allow users to save incomplete forms
2. **Form Templates**: Pre-filled forms for common scenarios
3. **Voice Input**: Allow voice input for text fields
4. **Photo Attachments**: Allow attaching photos for preferences
5. **Location Services**: Auto-detect user's city
6. **Smart Suggestions**: AI-powered suggestions based on preferences
7. **Offline Support**: Queue form submissions when offline

---

## Notes

- All forms should follow the mobile app's design system
- Use native components where possible for better UX
- Ensure forms work on both iOS and Android
- Test on various screen sizes (iPhone SE to iPhone Pro Max)
- Consider landscape orientation support
- Optimize for one-handed use where possible

---

## Related Documentation- **COE Specification**: See `architecture/coe-specification.md`
- **Bot Architecture**: See `architecture/bot-architecture-plan.md`
- **Mobile App Plan**: See `MOBILE-APP-IMPLEMENTATION-PLAN.md`
- **Feature Flags**: See `FEATURE-FLAGS.md` - Client COE creation/editing can be disabled via feature flag