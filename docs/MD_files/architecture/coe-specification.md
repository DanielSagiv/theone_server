# COE (Curated One Experience) Specification

## Overview
**COE = Curated One Experience** - A comprehensive, personalized event package that combines multiple locations/events into a cohesive client experience, managed by admins and executed by runners.

## Core Concept
- **Client-Centric**: Built around client requests and preferences
- **Multi-Event Package**: Combines multiple events from different locations
- **Three-Party System**: Client (purchaser), Admin (manager), Runner (executor)
- **End-to-End**: From client request → curated experience → payment → execution
- **Manual Creation**: Initially created manually by admins through dashboard interface
- **Future Automation**: Planned automated creation based on client preferences and AI

## COE Structure

### **COE Composition**
- **COE → Events → Locations**: Each COE contains multiple events, and each event is associated with a location/club
- **Hierarchy**: COE (package) → Events (individual experiences) → Locations (venues)
- **Event Properties**: Date/time, capacity, pricing, status, runner assignment
- **Location Properties**: Venue details, address, amenities, capacity
- **Sequential Experience**: Events can be ordered chronologically across different venues
- **Flexible Duration**: Can span multiple days with multiple venues

### **Example COE Structure**
```
COE: "Las Vegas VIP Weekend"
├── Event 1: Friday Night Club → Location: "XS Nightclub"
├── Event 2: Saturday Pool Party → Location: "Encore Beach Club"  
├── Event 3: Sunday Brunch → Location: "Wynn Buffet"
└── Event 4: Sunday Night Show → Location: "Cirque du Soleil"
```

### **COE Associations**

#### **1. Client (Primary Owner)**
- **Role**: The person who purchases and owns the COE
- **Responsibilities**: 
  - Reviews COE proposal
  - Accepts terms and conditions
  - Makes payment/deposit
  - Can invite additional participants
- **Permissions**: View COE, accept/reject, communicate with admin

#### **2. Admin (Manager)**
- **Role**: The concierge/admin who manages and approves the COE
- **Responsibilities**:
  - Builds COE from client request
  - Curates events and locations
  - Sets pricing and policies
  - Approves final COE
  - Manages client communication
  - Handles payments and refunds
- **Permissions**: Full COE management, event selection, pricing, approval

#### **3. Runner (Executor)**
- **Role**: On-premise coordinator who ensures smooth execution
- **Responsibilities**:
  - Coordinate with venue staff and vendors
  - Track event timeline and cue activities
  - Troubleshoot problems in real time
  - Keep client informed and comfortable
  - Perform quality checks on setup and service
- **Assignment Levels**:
  - **COE-Level**: Assigned to entire COE (all events)
  - **Event-Level**: Assigned to specific events within COE
  - **Flexible**: Can have different runners for different events

## COE Data Model

### **COE Schema**
```javascript
{
  _id: ObjectId,
  // Core Information
  name: String, // COE title/description
  description: String, // Detailed description
  status: String, // draft, approved, sent, accepted, rejected, expired
  
  // Manual Creation Fields
  created_method: String, // 'manual' or 'automated'
  created_by: ObjectId, // Admin who created the COE
  creation_notes: String, // Admin notes during creation
  
  // Associations
  client_id: ObjectId, // Primary client/owner
  admin_id: ObjectId, // Managing admin
  participants: [{ // Additional clients
    user_id: ObjectId,
    role: String, // 'owner', 'participant'
    status: String, // 'pending', 'accepted', 'rejected'
    added_at: Date
  }],
  
  // Runner Assignment
  runner_assignment: {
    type: String, // 'coe' or 'event'
    runner_id: ObjectId,
    assigned_by: ObjectId, // admin who assigned
    assigned_at: Date,
    status: String, // 'assigned', 'confirmed', 'active', 'completed'
    notes: String
  },
  
  // Financial
  currency: String, // USD
  subtotal: Number,
  taxes: Number,
  fees: Number,
  total: Number,
  deposit_required: Number,
  deposit_paid: Number,
  
  // Timeline
  request_date: Date, // When client submitted request
  approved_date: Date, // When admin approved
  sent_date: Date, // When sent to client
  accepted_date: Date, // When client accepted
  start_date: Date, // First event date
  end_date: Date, // Last event date
  
  // Content
  events: [COEItemSchema], // List of events
  available_seats: [{ // Pre-selected available seats
    event_id: ObjectId,
    seat_id: ObjectId,
    seat_code: String,
    capacity: Number,
    base_price: Number,
    event_price: Number,
    available_from: Date,
    available_until: Date
  }],
  policies: String, // Terms and conditions
  notes: String, // Admin notes
  client_notes: String, // Client-specific notes
  
  // Metadata
  sharable: Boolean, // Can be shared with other clients
  created_at: Date,
  updated_at: Date
}
```

### **COEItem Schema (Events in COE)**
```javascript
{
  _id: ObjectId,
  coe_id: ObjectId,
  
  // Event Reference
  event_id: ObjectId,
  event_date: Date,
  event_time: String,
  
  // Pricing
  base_price: Number,
  quantity: Number,
  total_price: Number,
  
  // Runner Assignment (Event-Level)
  runner_assignment: {
    runner_id: ObjectId,
    assigned_by: ObjectId,
    assigned_at: Date,
    status: String,
    notes: String
  },
  
  // Status
  status: String, // 'pending', 'confirmed', 'completed', 'cancelled'
  
  // Notes
  notes: String, // Event-specific notes
  client_notes: String, // Client notes for this event
  
  // Ordering
  sequence: Number, // Order within COE
  created_at: Date
}
```

## COE Creation Methods

### **Phase 1: Manual Creation (Current)**
- **Method**: Admin creates COEs manually through EJS dashboard interface
- **Process**: 
  - Admin selects events from available events with available seats/tables
  - Admin configures pricing, dates, and policies
  - Admin assigns runners and clients
  - COE is built step-by-step through admin interface
- **Limitations**: 
  - Requires manual event selection
  - No automated availability checking
  - Manual pricing calculations
- **Use Case**: Initial implementation, testing, and complex custom COEs

### **Phase 2: Automated Creation (Future)**
- **Method**: System automatically suggests and builds COEs based on client preferences
- **Process**:
  - Client inputs preferences (dates, budget, location types, etc.)
  - System analyzes available events and seats
  - AI/algorithm suggests optimal COE combinations
  - Admin reviews and approves automated suggestions
- **Features**:
  - Smart event matching
  - Automatic pricing optimization
  - Availability conflict resolution
  - Preference-based recommendations
- **Use Case**: Scale operations, reduce admin workload, faster COE creation

### **Manual Creation Workflow (EJS Implementation)**

#### **Step 1: COE Setup**
- Admin opens COE creation modal in dashboard
- Enters basic COE information (name, description, client)
- Sets general policies and terms
- COE status: `draft`

#### **Step 2: Event Selection**
- Admin browses available events (filtered by date, location, availability)
- Selects events with available seats/tables
- Views event details (location, capacity, pricing)
- Adds events to COE with sequence order
- Sets event-specific pricing and policies

#### **Step 3: Seat/Table Assignment**
- For each selected event, admin views available inventory
- Selects specific seats/tables from location inventory
- Configures seat-specific pricing and capacity
- Validates availability and conflicts
- Sets booking requirements and restrictions

#### **Step 4: Runner Assignment**
- Admin assigns runner(s) at COE or event level
- Sets runner responsibilities and notes
- Configures runner communication preferences
- Sets assignment status and confirmation requirements

#### **Step 5: Pricing & Policies**
- System calculates total pricing based on selected events and seats
- Admin sets taxes, fees, and deposit requirements
- Configures payment terms and policies
- Sets cancellation and refund policies

#### **Step 6: Review & Approval**
- Admin reviews complete COE package
- Validates all selections and pricing
- Sets final policies and terms
- Approves COE for client review
- COE status: `approved`

#### **Step 7: Client Communication**
- System sends COE to client for review
- Client can accept, reject, or request changes
- Admin handles client communication and modifications
- COE status: `sent` → `accepted` or `rejected`

## COE Workflow

### **1. Client Request Phase**
- Client submits request with preferences
- System creates initial COE draft
- Admin receives notification

### **2. COE Building Phase**
- Admin curates events from available locations
- Builds COE with events, pricing, policies
- Sets runner assignments (COE or event level)
- COE status: `draft`

### **3. Admin Approval Phase**
- Admin reviews and approves COE
- System validates availability
- COE status: `approved`

### **4. Client Review Phase**
- COE sent to client for review
- Client can communicate with admin
- COE status: `sent`

### **5. Client Acceptance Phase**
- Client accepts terms and pays deposit
- System captures payment
- COE status: `accepted`

### **6. Execution Phase**
- Runner receives assignment notification
- Events are executed according to schedule
- Runner coordinates with venues
- COE status: `completed`

## Runner Assignment System

### **Assignment Types**

#### **COE-Level Assignment**
- Single runner assigned to entire COE
- Responsible for all events in the package
- Coordinates overall experience flow
- Manages client throughout entire duration

#### **Event-Level Assignment**
- Different runners for different events
- Specialized runners for specific venues
- Event-specific coordination
- More granular control and expertise

### **Assignment Process**
1. **Admin Assignment**: Admin assigns runner during COE building
2. **Runner Notification**: Runner receives assignment notification
3. **Runner Confirmation**: Runner confirms availability
4. **Execution**: Runner coordinates event execution
5. **Completion**: Runner reports completion status

### **Runner Responsibilities**
- **Pre-Event**: Confirm with venues, prepare logistics
- **During Event**: Coordinate with staff, manage timeline
- **Post-Event**: Report status, handle issues
- **Client Communication**: Keep client informed throughout

## COE Features

### **Core Features**
1. **COE Builder**: Drag-and-drop event selection and ordering
2. **Pricing Calculator**: Automatic pricing with taxes and fees
3. **Runner Assignment**: Flexible assignment system
4. **Client Communication**: Built-in messaging system
5. **Payment Integration**: Deposit and full payment capture
6. **Status Tracking**: Complete workflow management
7. **Multi-Client Sharing**: Additional participants
8. **Upgrade System**: Propose enhancements with price deltas

### **Admin Features**
- **COE Dashboard**: Overview of all COEs
- **Builder Interface**: Intuitive COE creation
- **Runner Management**: Assignment and tracking
- **Client Communication**: Messaging and updates
- **Payment Management**: Capture, refunds, transactions
- **Analytics**: COE performance and revenue

### **Client Features**
- **COE View**: Mobile-first experience display
- **Itinerary**: Event schedule and details
- **Payment**: Secure payment processing
- **Communication**: Chat with admin
- **Sharing**: Invite additional participants
- **Upgrades**: Review and accept upgrade offers
- **COE Creation**: Can create COEs (when `ENABLE_CLIENT_COE_CREATION=true` feature flag is enabled)
- **COE Editing**: Can edit COEs (when `ENABLE_CLIENT_COE_EDITING=true` feature flag is enabled) - See `FEATURE-FLAGS.md`

## Integration Points

### **With Existing Systems**
- **Events**: COE contains multiple events
- **Locations**: Events reference location data
- **Users**: Client, admin, runner associations
- **Payments**: COE-level payment processing
- **Audit Log**: All COE actions tracked

### **External Systems**
- **Payment Gateway**: The1 gateway integration
- **Notification System**: SMS/email notifications
- **Venue Communication**: Runner-venue coordination
- **Calendar Integration**: Event scheduling

## Success Metrics

### **Business Metrics**
- COE completion rate
- Client satisfaction scores
- Revenue per COE
- Runner performance ratings
- Upgrade acceptance rate

### **Operational Metrics**
- COE build time
- Approval workflow efficiency
- Payment capture success
- Runner response time
- Client communication volume

## EJS Admin Interface Specifications

### **COE Management Dashboard**
- **COE List View**: Table with status, client, events count, total value
- **COE Creation Modal**: Multi-step wizard for manual creation
- **COE Details Modal**: View/edit existing COEs
- **Event Selection Interface**: Browse and select available events
- **Seat Assignment Interface**: Visual seat selection with availability
- **Runner Assignment Interface**: Assign and manage runners
- **Pricing Calculator**: Real-time pricing updates

### **Integration with Existing Dashboard**
- **Navigation**: Add "COEs" section to main sidebar
- **Modal System**: Extend existing modal framework
- **API Integration**: Use existing `makeApiRequest` pattern
- **Styling**: Follow existing CSS patterns and design system
- **Responsive**: Mobile-friendly interface design

### **Required API Endpoints**
- `GET /v1/coes` - List all COEs
- `POST /v1/coes` - Create new COE
- `GET /v1/coes/:id` - Get COE details
- `PUT /v1/coes/:id` - Update COE
- `DELETE /v1/coes/:id` - Delete COE
- `POST /v1/coes/:id/events` - Add event to COE
- `DELETE /v1/coes/:id/events/:eventId` - Remove event from COE
- `PUT /v1/coes/:id/seats` - Update seat assignments
- `POST /v1/coes/:id/runners` - Assign runner
- `PUT /v1/coes/:id/status` - Update COE status

## Implementation Phases

### **Phase 1: Manual COE Creation (Current)**
- COE data model and schema
- EJS admin interface for COE creation
- Event selection with availability checking
- Seat/table assignment interface
- Basic COE builder workflow
- Client association and communication
- Status workflow management
- Runner assignment system

### **Phase 2: Enhanced Manual Features**
- Advanced event filtering and search
- Bulk seat selection and assignment
- Pricing calculator with real-time updates
- COE templates and presets
- Enhanced runner management
- Client communication system
- Payment integration

### **Phase 3: Automated COE Creation (Future)**
- Client preference input system
- AI-powered event matching
- Automated availability checking
- Smart pricing optimization
- Conflict resolution system
- Automated COE suggestions
- Admin review and approval workflow

### **Phase 4: Advanced Features**
- Multi-client sharing
- Upgrade system
- Analytics dashboard
- Performance optimization
- Mobile client interface
- Integration with external systems

---

*This specification serves as the foundation for implementing the COE system according to the MVP requirements and business needs.*
