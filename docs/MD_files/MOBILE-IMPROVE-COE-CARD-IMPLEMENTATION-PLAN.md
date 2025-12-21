# Mobile COE Card Improvement - Implementation Plan

**Document Created:** December 21, 2025  --
**Purpose:** Redesign and improve the COE card interface for mobile, focusing on easy browsing and editing of COE events and seats with enhanced visual display

---

## Executive Summary

The current mobile COE card uses a tab-based interface that doesn't provide enough information in early stages and makes it difficult for admins (and later clients) to easily browse and edit COE events and seats. This plan outlines a redesign inspired by the dashboard's slide-based approach, with enhanced image display and swipeable navigation for a smoother, more intuitive COE creation and editing experience.

---

## Current State Analysis

### Dashboard COE Display (Reference)
The dashboard implementation provides:
- **Rich visual display** with event and seat images prominently featured
- **Slide/carousel navigation** for browsing events and seats within a COE
- **Comprehensive information** visible without excessive tabs
- **Media galleries** showing venue images, seat images, and location thumbnails
- **Inline editing capabilities** for seat pricing and selection
- **Event grouping** by event with seats displayed as carousel slides
- **Visual status indicators** for seats (available, selected, held, etc.)
- **AI recommendations** displayed inline with seat information
- **Upgrade offers** integrated into the event/seat display

### Current Mobile COE Card Issues
1. **Too many tabs** - Information is hidden behind tabs, requiring multiple taps to see all details
2. **Limited visual information** - Images and media are not prominently displayed
3. **No swipe navigation** - Users must tap through tabs instead of swiping
4. **Insufficient early-stage information** - Key details (events, seats, images) are not visible at first glance
5. **Difficult editing flow** - Editing events and seats requires navigating through multiple screens
6. **No visual browsing** - Can't easily browse through events and seats with images

---

## Design Goals

### Primary Objectives
1. **Visual-First Design**: Make images (venue, seats, events) the primary visual element
2. **Swipeable Navigation**: Enable horizontal swiping to browse events and seats
3. **Progressive Disclosure**: Show essential information upfront, details on demand
4. **Easy Editing**: Allow inline editing of events and seats without complex navigation
5. **Smooth Experience**: Create a fluid, intuitive flow for COE creation and editing
6. **Mobile-Optimized**: Leverage touch gestures and mobile-specific interactions

### Target Users
- **Primary**: Admins creating COEs for clients
- **Secondary**: Clients viewing and potentially editing their COEs (future phase)

---

## Proposed Design

### 1. COE Card Structure (Admin Creating COE for Client)

#### Main Card Layout
```
┌─────────────────────────────────────┐
│  COE Header                         │
│  ┌───────────────────────────────┐ │
│  │ [Status Badge]  COE Name     │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │  Event Carousel (Swipeable)   │ │
│  │  ┌─────────────────────────┐ │ │
│  │  │ [Event Image]           │ │ │
│  │  │ Event Name              │ │ │
│  │  │ Venue Name              │ │ │
│  │  │ Date & Time             │ │ │
│  │  │ [Seats Count] [Price]   │ │ │
│  │  └─────────────────────────┘ │ │
│  │  ◄ [1/3] ►                    │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │  Current Event Details       │ │
│  │  ┌─────────────────────────┐ │ │
│  │  │ Seats Carousel (Swipe)  │ │ │
│  │  │ ┌─────────────────────┐ │ │ │
│  │  │ │ [Seat Image]        │ │ │ │
│  │  │ │ Table Code          │ │ │ │
│  │  │ │ Capacity | Price    │ │ │ │
│  │  │ │ [Status Badge]      │ │ │ │
│  │  │ └─────────────────────┘ │ │ │
│  │  │ ◄ [1/5] ►                │ │ │
│  │  └─────────────────────────┘ │ │
│  │  [Edit Seats] [Add Seats]    │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │  Quick Actions                │ │
│  │  [Add Event] [Edit COE]      │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
```

#### Key Features

**1. Event Carousel (Top Section)**
- **Horizontal swipeable carousel** showing all events in the COE
- **Large event images** (venue images, event images) as primary visual
- **Event summary** visible on each slide:
  - Event name
  - Venue name with thumbnail
  - Date and time
  - Number of seats selected
  - Total price for this event
- **Dot indicators** showing current event position (e.g., "1/3")
- **Swipe gestures** to navigate between events
- **Tap to expand** for full event details

**2. Seat Carousel (Within Current Event)**
- **Horizontal swipeable carousel** for seats/tables in the current event
- **Large seat images** (table photos, venue views) prominently displayed
- **Seat information** on each slide:
  - Table code/number
  - Capacity (number of people)
  - Base price and event price
  - Status badge (Selected, Available, Held, etc.)
  - AI recommendation (if available)
- **Media gallery** showing multiple images per seat (swipeable within seat slide)
- **Dot indicators** for seat navigation
- **Quick actions** on each seat:
  - Edit price
  - Remove seat
  - View details

**3. Visual Enhancements**
- **High-quality images** displayed at optimal size (not thumbnails)
- **Image galleries** with swipeable multiple images per venue/seat
- **Location thumbnails** showing venue images
- **Status indicators** with color coding and clear labels
- **Price displays** with clear formatting and currency symbols

**4. Editing Capabilities**
- **Inline editing** for seat prices (tap to edit)
- **Quick add/remove** buttons for seats
- **Event management** (add event, remove event, edit event)
- **Visual feedback** for all actions (animations, loading states)

---

## Component Architecture

### New Components to Create

#### 1. `COEEventCarousel`
- **Purpose**: Display all COE events in a swipeable carousel
- **Props**:
  - `events`: Array of event objects
  - `currentEventIndex`: Currently visible event index
  - `onEventChange`: Callback when event changes
  - `onEventPress`: Callback when event is tapped
  - `onAddEvent`: Callback to add new event
- **Features**:
  - Horizontal `FlatList` or `ScrollView` with pagination
  - Large event images (full width, aspect ratio maintained)
  - Event summary overlay on image
  - Dot indicators for navigation
  - Swipe gestures for navigation
  - Smooth animations between events

#### 2. `COESeatCarousel`
- **Purpose**: Display seats for the current event in a swipeable carousel
- **Props**:
  - `seats`: Array of seat objects for current event
  - `currentSeatIndex`: Currently visible seat index
  - `onSeatChange`: Callback when seat changes
  - `onSeatPress`: Callback when seat is tapped
  - `onEditSeat`: Callback to edit seat
  - `onRemoveSeat`: Callback to remove seat
  - `onAddSeat`: Callback to add new seat
- **Features**:
  - Horizontal `FlatList` or `ScrollView` with pagination
  - Large seat images (full width, aspect ratio maintained)
  - Seat information overlay
  - Media gallery within each seat slide (nested carousel)
  - Dot indicators for navigation
  - Swipe gestures for navigation
  - Quick action buttons

#### 3. `COEImageGallery`
- **Purpose**: Display multiple images for venues/seats with swipeable gallery
- **Props**:
  - `images`: Array of image objects (url, caption, type)
  - `currentIndex`: Currently visible image index
  - `onImageChange`: Callback when image changes
  - `onImagePress`: Callback to open full-screen view
- **Features**:
  - Horizontal swipeable gallery
  - Full-screen image viewer (modal)
  - Image captions
  - Dot indicators
  - Pinch-to-zoom support

#### 4. `COEEventCard` (Enhanced)
- **Purpose**: Display individual event in the carousel
- **Props**:
  - `event`: Event object
  - `isActive`: Whether this event is currently visible
  - `onPress`: Callback when event is tapped
- **Features**:
  - Large event image
  - Event information overlay
  - Venue thumbnail
  - Date/time display
  - Seat count and price summary

#### 5. `COESeatCard` (Enhanced)
- **Purpose**: Display individual seat in the carousel
- **Props**:
  - `seat`: Seat object
  - `isActive`: Whether this seat is currently visible
  - `onPress`: Callback when seat is tapped
  - `onEdit`: Callback to edit seat
  - `onRemove`: Callback to remove seat
- **Features**:
  - Large seat image
  - Seat information overlay
  - Status badge
  - Price display
  - AI recommendation display
  - Quick action buttons

#### 6. `COEEditSeatModal`
- **Purpose**: Modal for editing seat details (price, notes, etc.)
- **Props**:
  - `seat`: Seat object to edit
  - `visible`: Whether modal is visible
  - `onClose`: Callback to close modal
  - `onSave`: Callback to save changes
- **Features**:
  - Price editing
  - Notes/remarks input
  - Validation
  - Save/cancel actions

#### 7. `COEAddEventModal`
- **Purpose**: Modal for adding a new event to the COE
- **Props**:
  - `visible`: Whether modal is visible
  - `onClose`: Callback to close modal
  - `onAdd`: Callback to add event
  - `coeId`: COE ID
- **Features**:
  - Event search/selection
  - Date/time selection
  - Seat selection
  - Validation

### Modified Components

#### 1. `COECard` (Redesign)
- Remove tab-based navigation
- Add event carousel at top
- Show current event's seats in carousel below
- Add quick action buttons
- Improve visual hierarchy

#### 2. `COEDetailScreen` (Enhancement)
- Integrate new carousel components
- Add editing capabilities
- Improve image display
- Add swipe navigation

---

## User Flow: Admin Creating COE for Client

### Flow Diagram
```
1. Admin clicks "Create COE" on client card
   ↓
2. Bot responds with COE creation form
   ↓
3. Admin fills form (dates, budget, party size, notes)
   ↓
4. Admin submits form
   ↓
5. Bot creates COE draft and responds with COE card
   ↓
6. COE Card displays with:
   - Event carousel (empty or with suggested events)
   - "Add Event" button
   ↓
7. Admin taps "Add Event"
   ↓
8. Event selection modal opens
   ↓
9. Admin selects event(s)
   ↓
10. Selected events appear in event carousel
   ↓
11. Admin swipes to an event
   ↓
12. Seat carousel appears below showing seats for that event
   ↓
13. Admin swipes through seats, viewing images and details
   ↓
14. Admin taps "Add Seats" or selects seats from available list
   ↓
15. Selected seats appear in seat carousel
   ↓
16. Admin can:
    - Swipe to browse events and seats
    - Tap seat to edit price/details
    - Remove seat from carousel
    - Add more events
    - Edit COE details
   ↓
17. Admin saves COE
   ↓
18. COE is created/updated with all events and seats
```

### Detailed Interactions

#### Adding Events
1. Admin taps "Add Event" button
2. Modal opens with event search/selection
3. Admin can:
   - Search events by name, venue, date
   - Filter by location, date range
   - View event details (images, description, pricing)
4. Admin selects one or more events
5. Events are added to COE and appear in event carousel
6. Admin can immediately swipe to see new events

#### Browsing Events
1. Admin swipes horizontally on event carousel
2. Events slide smoothly with images
3. Current event is highlighted
4. Dot indicators show position (e.g., "2/5")
5. Event details (name, venue, date, seat count) are visible
6. Admin can tap event to see full details

#### Viewing and Selecting Seats
1. Admin swipes to an event in event carousel
2. Seat carousel appears below showing seats for that event
3. Admin swipes horizontally to browse seats
4. Each seat shows:
   - Large seat image(s)
   - Table code
   - Capacity
   - Price (base and event price)
   - Status (available, selected, held)
   - AI recommendation (if available)
5. Admin can:
   - Tap "Add Seats" to select from available seats
   - Tap seat to edit details
   - Swipe through seat images (if multiple)
   - Remove seat from selection

#### Editing Seats
1. Admin taps on a seat in seat carousel
2. Edit modal opens with seat details
3. Admin can edit:
   - Event price (override base price)
   - Notes/remarks
   - Remove seat from COE
4. Changes are saved and reflected immediately in carousel

---

## Technical Implementation

### Libraries and Dependencies

#### Required Libraries
- **React Native Reanimated** (for smooth animations)
- **React Native Gesture Handler** (for swipe gestures)
- **React Native Image Viewer** (for full-screen image viewing)
- **React Native Fast Image** (for optimized image loading)

#### Optional Libraries
- **React Native Snap Carousel** (alternative to custom carousel)
- **React Native Image Zoom** (for pinch-to-zoom)

### State Management

#### COE Card State
```javascript
{
  coe: {
    id: string,
    name: string,
    status: string,
    events: Array<Event>,
    // ... other COE fields
  },
  currentEventIndex: number,
  currentSeatIndex: number,
  editingSeat: Seat | null,
  showAddEventModal: boolean,
  showEditSeatModal: boolean,
  loading: boolean,
  error: string | null
}
```

#### Event Object Structure
```javascript
{
  _id: string,
  name: string,
  description: string,
  start_datetime: string,
  location_id: {
    _id: string,
    name: string,
    media: Array<Media>
  },
  media: Array<Media>,
  seats: Array<Seat>,
  base_price: number,
  // ... other event fields
}
```

#### Seat Object Structure
```javascript
{
  _id: string,
  seat_code: string,
  capacity: number,
  base_price: number,
  event_price: number,
  status: string,
  media: Array<Media>,
  ai_recommendation: string | null,
  // ... other seat fields
}
```

### API Integration

#### Endpoints Used
- `GET /coes/:coeId` - Fetch COE details with events and seats
- `PUT /coes/:coeId` - Update COE
- `POST /coes/:coeId/events` - Add event to COE
- `DELETE /coes/:coeId/events/:eventId` - Remove event from COE
- `POST /coes/:coeId/seats` - Add seat to COE
- `DELETE /coes/:coeId/seats/:seatId` - Remove seat from COE
- `PUT /coes/:coeId/seats/:seatId` - Update seat details
- `GET /events` - Search/select events
- `GET /events/:eventId/seats` - Get available seats for event

### Performance Considerations

1. **Image Loading**
   - Lazy load images in carousel
   - Use placeholder images while loading
   - Cache images for offline viewing
   - Optimize image sizes for mobile

2. **Carousel Performance**
   - Virtualize carousel items (only render visible items)
   - Use `removeClippedSubviews` for FlatList
   - Limit number of items rendered at once
   - Implement pagination for large datasets

3. **State Updates**
   - Debounce rapid state changes
   - Batch API calls when possible
   - Optimize re-renders with React.memo
   - Use useCallback for event handlers

---

## Design Specifications

### Visual Design

#### Color Scheme
- Follow existing mobile app color palette (dark theme with gold accents)
- Status badges use same colors as current implementation
- Images should be displayed with proper contrast

#### Typography
- Event names: Large, bold, readable
- Venue names: Medium, secondary color
- Seat codes: Medium, bold
- Prices: Large, gold color (#D4AF37)
- Status badges: Small, uppercase, bold

#### Spacing and Layout
- Event carousel: Full width, aspect ratio 16:9 for images
- Seat carousel: Full width, aspect ratio 4:3 for images
- Padding: Consistent 16px margins
- Gap between carousel items: 12px

#### Image Display
- **Event images**: 
  - Primary: Venue image or event image
  - Fallback: Location thumbnail
  - Aspect ratio: 16:9
  - Border radius: 12px
  
- **Seat images**:
  - Primary: Seat/table photo
  - Fallback: Venue image
  - Aspect ratio: 4:3
  - Border radius: 8px
  
- **Image galleries**:
  - Multiple images per venue/seat
  - Swipeable within carousel item
  - Full-screen viewer on tap
  - Pinch-to-zoom support

### Animations

#### Carousel Transitions
- Smooth horizontal slide animation (300ms)
- Easing: ease-out
- Spring physics for natural feel

#### Modal Transitions
- Slide up from bottom (400ms)
- Fade in overlay (200ms)

#### Button Interactions
- Scale animation on press (0.95 scale)
- Ripple effect on tap

### Gestures

#### Swipe Gestures
- **Horizontal swipe**: Navigate between events/seats
- **Vertical swipe**: Dismiss modals
- **Swipe threshold**: 50px minimum distance
- **Velocity threshold**: 0.5 for quick swipe

#### Tap Gestures
- **Single tap**: Select item, open details
- **Long press**: Show context menu (optional)
- **Double tap**: Zoom image (in full-screen viewer)

---

## Implementation Phases

### Phase 1: Core Carousel Components (Week 1)
**Objectives:**
- Create `COEEventCarousel` component
- Create `COESeatCarousel` component
- Implement basic swipe navigation
- Display events and seats with images

**Tasks:**
1. Set up carousel infrastructure (React Native Reanimated + Gesture Handler)
2. Create `COEEventCarousel` with swipe navigation
3. Create `COESeatCarousel` with swipe navigation
4. Integrate image display with proper aspect ratios
5. Add dot indicators for navigation
6. Test swipe gestures and animations

**Deliverables:**
- Working event carousel with swipe navigation
- Working seat carousel with swipe navigation
- Images displayed correctly
- Smooth animations

### Phase 2: Enhanced Visual Display (Week 1-2)
**Objectives:**
- Enhance image display quality
- Add image galleries
- Improve visual hierarchy
- Add status badges and indicators

**Tasks:**
1. Implement `COEImageGallery` component
2. Add multiple images per venue/seat
3. Create full-screen image viewer
4. Enhance event and seat cards with better visuals
5. Add status badges with proper styling
6. Improve typography and spacing

**Deliverables:**
- High-quality image display
- Image galleries with swipe navigation
- Full-screen image viewer
- Enhanced visual design

### Phase 3: Editing Capabilities (Week 2)
**Objectives:**
- Add inline editing for seats
- Implement add/remove functionality
- Create edit modals
- Add event management

**Tasks:**
1. Create `COEEditSeatModal` component
2. Implement seat price editing
3. Add remove seat functionality
4. Create `COEAddEventModal` component
5. Implement add event functionality
6. Add remove event functionality
7. Integrate with API endpoints

**Deliverables:**
- Working edit seat modal
- Working add event modal
- Inline editing capabilities
- API integration for updates

### Phase 4: Integration and Polish (Week 2-3)
**Objectives:**
- Integrate new components into COE card
- Update COE detail screen
- Add loading states and error handling
- Polish animations and interactions

**Tasks:**
1. Redesign `COECard` component
2. Update `COEDetailScreen` with new components
3. Add loading states for API calls
4. Implement error handling
5. Add pull-to-refresh
6. Polish animations and transitions
7. Test on different screen sizes
8. Performance optimization

**Deliverables:**
- Fully integrated COE card with carousels
- Updated COE detail screen
- Smooth user experience
- Error handling and loading states

### Phase 5: Testing and Refinement (Week 3)
**Objectives:**
- Comprehensive testing
- Bug fixes
- Performance optimization
- User feedback integration

**Tasks:**
1. Test all user flows
2. Test on different devices and screen sizes
3. Performance testing and optimization
4. Bug fixes
5. Accessibility testing
6. User acceptance testing
7. Documentation

**Deliverables:**
- Fully tested and polished implementation
- Performance optimized
- Documentation complete
- Ready for production

---

## Success Metrics

### User Experience Metrics
- **Time to add event**: < 30 seconds
- **Time to browse events**: < 5 seconds per event
- **Time to select seats**: < 10 seconds per seat
- **User satisfaction**: > 4.5/5 rating
- **Error rate**: < 2%

### Technical Metrics
- **Carousel performance**: 60 FPS during swipe
- **Image load time**: < 2 seconds per image
- **API response time**: < 1 second
- **App size increase**: < 5MB

---

## Future Enhancements (Post-MVP)

### Client-Facing Features
- Allow clients to view COE with same carousel interface
- Enable clients to request changes (alternative events, seat upgrades)
- Add client feedback and rating system

### Advanced Features
- **AI-powered recommendations**: Show recommended events/seats based on preferences
- **Comparison view**: Compare multiple events/seats side-by-side
- **Favorites**: Save favorite events/seats for quick access
- **Sharing**: Share COE with others via link
- **Offline mode**: Cache COE data for offline viewing

### Analytics
- Track user interactions (swipes, taps, edits)
- Measure time spent on each event/seat
- Analyze most viewed images
- Identify pain points in user flow

---

## Dependencies and Prerequisites

### Backend Requirements
- API endpoints for COE CRUD operations
- API endpoints for event and seat management
- Image URLs properly formatted and accessible
- Media objects include proper image URLs and metadata

### Mobile App Requirements
- React Native Reanimated installed
- React Native Gesture Handler installed
- Image optimization libraries
- API client configured

### Design Assets
- High-quality event images
- High-quality seat/table images
- Venue images
- Placeholder images for loading states
- Icon assets for actions

---

## Risk Assessment

### Technical Risks
1. **Performance**: Large number of images may cause performance issues
   - *Mitigation*: Implement lazy loading, image caching, and virtualization

2. **Memory**: Multiple high-resolution images may consume too much memory
   - *Mitigation*: Optimize image sizes, use image compression, implement memory management

3. **API Latency**: Slow API responses may affect user experience
   - *Mitigation*: Implement caching, optimistic updates, loading states

### UX Risks
1. **Complexity**: Too many features may overwhelm users
   - *Mitigation*: Progressive disclosure, clear visual hierarchy, intuitive gestures

2. **Learning Curve**: Users may not understand swipe navigation
   - *Mitigation*: Onboarding hints, visual indicators, tooltips

### Business Risks
1. **Timeline**: Implementation may take longer than estimated
   - *Mitigation*: Phased approach, prioritize core features, regular checkpoints

2. **Scope Creep**: Additional features may be requested
   - *Mitigation*: Clear scope definition, change management process

---

## Conclusion

This implementation plan outlines a comprehensive redesign of the mobile COE card interface, focusing on visual-first design, swipeable navigation, and easy editing capabilities. The new design will provide admins (and later clients) with a smooth, intuitive experience for creating and managing COEs, with enhanced image display and streamlined workflows.

The phased approach ensures incremental delivery of value while maintaining code quality and performance. Regular testing and user feedback will guide refinements throughout the implementation process.

---

## Appendix

### A. Dashboard Reference Implementation
- Location: `server/views/test/dashboard.ejs`
- Key functions: `renderCOECard()`, `displayCOEViewModal()`, `loadEventSeatsForCOE()`
- Relevant lines: 7822-8600 (COE card rendering), 15012-15200 (COE view modal)

### B. Current Mobile Implementation
- COE Card: `mobile/src/components/COECard.js`
- COE Detail: `mobile/app/coe-detail.js`
- Current limitations: Tab-based navigation, limited image display, no swipe gestures

### C. Related Documentation
- `MOBILE-APP-IMPLEMENTATION-PLAN.md`: Overall mobile app architecture
- `MOBILE-CREATE-COE-IMPLEMENTATION-PLAN.md`: COE creation flow
- Dashboard EJS: Reference for visual design and interactions

---

**Document Status**: Draft  
**Next Review**: After Phase 1 completion  
**Owner**: Mobile Development Team  
**Stakeholders**: Product, Design, Backend Teams

