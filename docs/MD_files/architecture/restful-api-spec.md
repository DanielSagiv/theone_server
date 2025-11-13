# The1 Platform - RESTful API Specification

## 1. Project Overview
A RESTful API backend serving multiple client applications (web, mobile) with session-based authentication and EJS test interface for endpoint validation. All API endpoints return JSON responses for easy client-side handling.

## 2. Architecture
- **API Type**: RESTful API serving multiple client applications
- **Backend**: Node.js with Express
- **Database**: MongoDB
- **Authentication**: Session-based with JWT tokens
- **Response Format**: All API endpoints return JSON responses for client consumption
- **Test Interface**: EJS views for API testing and validation
- **Security**: Encrypted/hashed passwords with bcrypt

## 3. Session Management
- **Session Storage**: Database-stored sessions with expiration
- **Token Type**: JWT tokens for session validation
- **Session Lifecycle**: 
  - Login creates session in database
  - Session remains active until expiration or logout
  - All protected endpoints validate session from database
  - Session includes user permissions and role information

## 4. User Endpoints (Phase 1)

### 4.1 Authentication Endpoints
```
POST /v1/auth/signup
- Register new user
- Hash password with bcrypt
- Create user record in database
- Return success/error response

POST /v1/auth/signin
- User login with email/password
- Validate credentials
- Create session in database
- Return JWT token and user info

POST /v1/auth/logout
- Invalidate current session
- Remove session from database
- Return success response

POST /v1/auth/renew-password
- Request password renewal
- Send reset email (future implementation)
- Return success response

PUT /v1/auth/reset-password
- Reset password with token
- Validate reset token
- Update password with new hash
- Return success response
```

### 4.2 User Management Endpoints
```
GET /v1/users/profile
- Get current user profile
- Requires valid session
- Return user information

PUT /v1/users/profile
- Update user profile
- Requires valid session
- Validate input data
- Return updated user info

GET /v1/users
- List all users (admin only)
- Requires admin session
- Return paginated user list

GET /v1/users/:id
- Get specific user by ID
- Requires admin session or own profile
- Return user information
```

## 5. Data Models

### 5.1 User Schema
```javascript
{
  _id: ObjectId,
  email: String (unique, required),
  password: String (hashed, required),
  firstName: String (required),
  lastName: String (required),
  role: String (enum: ['admin', 'client', 'runner'], default: 'client'),
  isActive: Boolean (default: true),
  lastLogin: Date,
  createdAt: Date,
  updatedAt: Date,
  resetPasswordToken: String (optional),
  resetPasswordExpires: Date (optional)
}
```

### 5.2 Session Schema
```javascript
{
  _id: ObjectId,
  userId: ObjectId (ref: 'User'),
  token: String (JWT token, unique),
  expiresAt: Date,
  isActive: Boolean (default: true),
  createdAt: Date,
  lastAccessedAt: Date,
  userAgent: String (optional),
  ipAddress: String (optional)
}
```

## 6. API Response Format

**Important**: All API endpoints return JSON responses only. No HTML, plain text, or other formats are returned by the RESTful API endpoints.

### 6.1 Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### 6.2 Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": { ... } // Optional additional error details
  }
}
```

### 6.3 Pagination Response
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "pages": 5
  }
}
```

### 6.4 Authentication Response
```json
{
  "success": true,
  "data": {
    "token": "jwt_token_here",
    "user": {
      "id": "user_id",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "client"
    },
    "expiresAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Login successful"
}
```

## 7. Authentication Flow

### 7.1 Login Process
1. Client sends POST `/v1/auth/signin` with email/password
2. Server validates credentials against database
3. Server creates new session record in database
4. Server generates JWT token with user info
5. Server returns token and user profile
6. Client stores token for subsequent requests

### 7.2 Protected Endpoint Access
1. Client sends request with `Authorization: Bearer <token>` header
2. Server validates JWT token signature
3. Server checks if session exists and is active in database
4. Server verifies session hasn't expired
5. Server checks user permissions for requested endpoint
6. Server processes request and returns response

### 7.3 Logout Process
1. Client sends POST `/v1/auth/logout` with token
2. Server validates token and finds session
3. Server marks session as inactive in database
4. Server returns success response

## 8. Test Interface (EJS Views)

**Note**: The EJS test interface is separate from the RESTful API and serves HTML pages for testing purposes only. The actual API endpoints (`/v1/*`) always return JSON.

### 8.1 Test Routes
```
GET /test/login
- Display login form for testing

GET /test/dashboard
- Display user dashboard with API testing tools

GET /test/users
- Display user management testing interface

GET /test/sessions
- Display session management testing interface
```

### 8.2 Test Features
- **Login Form**: Test signin/signup endpoints (calls `/v1/auth/*` which return JSON)
- **API Testing**: Forms to test all user endpoints (displays JSON responses)
- **Session Display**: Show current session status
- **Response Viewer**: Display JSON API responses in formatted view
- **Error Testing**: Test error scenarios and display JSON error responses

## 9. Security Measures

### 9.1 Password Security
- **Hashing**: bcrypt with 12 salt rounds
- **Validation**: Strong password requirements
- **Reset**: Secure token-based password reset

### 9.2 Session Security
- **JWT Signing**: HMAC SHA256 with secret key
- **Expiration**: Configurable session timeout
- **Database Storage**: Sessions stored in MongoDB
- **Cleanup**: Automatic cleanup of expired sessions

### 9.3 API Security
- **Input Validation**: Joi or similar validation library
- **Rate Limiting**: Express rate limit middleware
- **CORS**: Configured for client applications
- **Headers**: Security headers (helmet.js)

## 10. Implementation Phases

### Phase 1: User Authentication (Current)
- [ ] User schema and database setup
- [ ] Password hashing with bcrypt
- [ ] JWT token generation and validation
- [ ] Session management in database
- [ ] Signup, signin, logout endpoints
- [ ] Password renewal endpoints
- [ ] EJS test interface for authentication

### Phase 2: User Management
- [ ] User profile endpoints
- [ ] User listing and management
- [ ] Role-based access control
- [ ] User update and deletion

### Phase 3: API Expansion
- [ ] Locations CRUD endpoints
- [ ] Events CRUD endpoints
- [ ] COE lifecycle endpoints
- [ ] Additional business logic

## 11. Environment Configuration

### 11.1 Required Environment Variables
```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb+srv://sagiv:madonna@cluster0.et5fx.mongodb.net/kairo?retryWrites=true&w=majority
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=24h
BCRYPT_ROUNDS=12
SESSION_TIMEOUT=86400000
```

### 11.2 Database Collections
- `users` - User accounts and profiles
- `sessions` - Active user sessions
- `audit_logs` - System audit trail

## 12. Error Codes

### 12.1 Authentication Errors
- `AUTH_INVALID_CREDENTIALS` - Invalid email/password
- `AUTH_SESSION_EXPIRED` - Session has expired
- `AUTH_SESSION_NOT_FOUND` - Session not found
- `AUTH_INSUFFICIENT_PERMISSIONS` - User lacks required permissions
- `AUTH_ACCOUNT_DISABLED` - User account is disabled

### 12.2 Validation Errors
- `VALIDATION_REQUIRED_FIELD` - Required field missing
- `VALIDATION_INVALID_FORMAT` - Invalid data format
- `VALIDATION_EMAIL_EXISTS` - Email already registered
- `VALIDATION_WEAK_PASSWORD` - Password doesn't meet requirements

### 12.3 System Errors
- `SYSTEM_DATABASE_ERROR` - Database operation failed
- `SYSTEM_INTERNAL_ERROR` - Internal server error
- `SYSTEM_RATE_LIMIT` - Too many requests

## 13. Testing Strategy

### 13.1 Unit Tests
- Password hashing and validation
- JWT token generation and validation
- Session management functions
- Input validation functions

### 13.2 Integration Tests
- Authentication flow end-to-end
- Session lifecycle testing
- API endpoint testing
- Database operations

### 13.3 EJS Test Interface
- Manual testing of all endpoints
- Session state visualization
- Error scenario testing
- Performance testing

---

## Next Steps
1. Set up project structure with Express and TypeScript
2. Configure MongoDB connection and schemas
3. Implement authentication middleware
4. Create user endpoints with session management
5. Build EJS test interface
6. Add comprehensive error handling and validation
