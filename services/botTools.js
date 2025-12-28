/**
 * Bot Tool Registry
 * @description Defines all available tools for OpenAI function calling
 * 
 * Each tool includes:
 * - OpenAI function calling schema (name, description, parameters)
 * - Metadata (schema_version, permissions, handler name)
 * - Handler functions are implemented in botToolHandlers.js
 */

const { isClientCOECreationEnabled, isClientCOEEditingEnabled } = require('../utils/featureFlags');

const toolRegistry = {
  /**
   * Tool 1: Get Events by Date Range
   * @description Query events within a date range with optional filters
   */
  get_events_by_date: {
    name: 'get_events_by_date',
    description: 'Query upcoming events, future events, or events within a date range. Use this tool when users ask about "upcoming events", "future events", "events in the next X days/weeks/months", "show me all future events", or any event queries with dates. Convert natural language dates (like "next 10 days", "next week", "in 2 months", "today", "tomorrow") to ISO 8601 format before calling. Returns events with basic info, location details, pricing, availability, and sentiment data.',
    parameters: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Start date in ISO 8601 format (e.g., "2025-11-15T00:00:00Z"). Convert natural language like "today", "next week", or "in 10 days" to ISO format. For "next 10 days", use today as start_date. Always use current date/time as reference for relative dates.',
          format: 'date-time'
        },
        end_date: {
          type: 'string',
          description: 'End date in ISO 8601 format (e.g., "2025-11-20T23:59:59Z"). Convert natural language like "next week", "in 10 days", or "next month" to ISO format. For "next 10 days", use today + 10 days as end_date. Always use current date/time as reference for relative dates.',
          format: 'date-time'
        },
        location: {
          type: 'string',
          description: 'Location name or city (optional filter)'
        },
        type: {
          type: 'string',
          description: 'Event type filter (optional)'
        },
        status: {
          type: 'string',
          description: 'Event status filter (default: "active")',
          enum: ['active', 'inactive', 'draft', 'cancelled']
        },
        search: {
          type: 'string',
          description: 'Text search in event name or description (optional)'
        }
      },
      required: ['start_date', 'end_date']
    },
    schema_version: '1.0.0',
    permissions: ['admin', 'client', 'runner'],
    handler: 'handleGetEventsByDate'
  },

  /**
   * Tool 2: Create COE Draft
   * @description Create a new COE with selected events and seats
   */
  create_coe_draft: {
    name: 'create_coe_draft',
    description: 'Create a new Curated One Experience (COE) with selected events and seats. Use this tool when users ask to "create a coe", "plan my experience", "build my experience", or want to create a curated experience. The COE will be created in "draft" status and requires approval. System auto-fills all required fields based on user context and preferences. If dates, budget, or preferences are missing, ask the user for them before creating.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'COE name (optional - will be auto-generated if not provided)'
        },
        description: {
          type: 'string',
          description: 'COE description (optional - can be left empty)'
        },
        start_date: {
          type: 'string',
          description: 'Start date in ISO 8601 format (e.g., "2025-11-15T00:00:00Z"). Convert natural language dates like "Nov 15, 2025", "next week", or "in 10 days" to ISO format. Always use current date/time as reference for relative dates.',
          format: 'date-time'
        },
        end_date: {
          type: 'string',
          description: 'End date in ISO 8601 format (e.g., "2025-11-20T23:59:59Z"). Convert natural language dates like "Nov 20, 2025", "next week", or "in 2 weeks" to ISO format. Always use current date/time as reference for relative dates.',
          format: 'date-time'
        },
        idempotency_key: {
          type: 'string',
          description: 'Unique key to prevent duplicate COE creation on retries (optional)'
        },
        events: {
          type: 'array',
          description: 'Array of event selections',
          items: {
            type: 'object',
            properties: {
              event_id: {
                type: 'string',
                description: 'Event MongoDB ID'
              },
              selected_seats: {
                type: 'array',
                description: 'Array of seat selections for this event',
                items: {
                  type: 'object',
                  properties: {
                    seat_id: {
                      type: 'string',
                      description: 'Seat MongoDB ID'
                    },
                    seat_code: {
                      type: 'string',
                      description: 'Seat code'
                    },
                    capacity: {
                      type: 'number',
                      description: 'Seat capacity'
                    }
                  },
                  required: ['seat_id', 'seat_code', 'capacity']
                }
              }
            },
            required: ['event_id']
          }
        },
        client_id: {
          type: 'string',
          description: 'Client ID (admin only - defaults to current user for clients)'
        },
        preferences: {
          type: 'object',
          description: 'User preferences for AI selection (optional)',
          properties: {
            budget_range: {
              type: 'object',
              properties: {
                min: { type: 'number' },
                max: { type: 'number' }
              }
            },
            location_preferences: {
              type: 'array',
              items: { type: 'string' },
              description: 'City/location names'
            },
            party_size: {
              type: 'number',
              description: 'Number of participants'
            },
            notes: {
              type: 'string',
              description: 'Additional preferences or notes'
            }
          }
        }
      },
      required: ['start_date', 'end_date']
    },
    schema_version: '1.0.0',
    permissions: isClientCOECreationEnabled() ? ['admin', 'client'] : ['admin'],
    handler: 'handleCreateCOEDraft'
  },

  /**
   * Tool 3: Update COE
   * @description Edit an existing COE (events, seats, dates, notes, etc.)
   */
  update_coe: {
    name: 'update_coe',
    description: 'Edit an existing COE. Use this tool when users ask to "update the COE", "change the COE", "edit my COE", "modify the COE we just created", or reference "the COE we just created". Can update events, seats, dates, notes, and other fields. Updates the COE in place (no versioning). If coe_id is not provided, use the active_coe_id from conversation context.',
    parameters: {
      type: 'object',
      properties: {
        coe_id: {
          type: 'string',
          description: 'COE MongoDB ID'
        },
        idempotency_key: {
          type: 'string',
          description: 'Unique key to prevent duplicate updates on retries (optional)'
        },
        updates: {
          type: 'object',
          description: 'Fields to update',
          properties: {
            name: {
              type: 'string',
              description: 'COE name'
            },
            description: {
              type: 'string',
              description: 'COE description'
            },
            start_date: {
              type: 'string',
              description: 'Start date in ISO 8601 format',
              format: 'date-time'
            },
            end_date: {
              type: 'string',
              description: 'End date in ISO 8601 format',
              format: 'date-time'
            },
            events: {
              type: 'array',
              description: 'Updated event list',
              items: {
                type: 'object',
                properties: {
                  event_id: { type: 'string' },
                  event_date: { type: 'string', format: 'date-time' },
                  event_time: { type: 'string' },
                  base_price: { type: 'number' },
                  quantity: { type: 'number' },
                  total_price: { type: 'number' },
                  sequence: { type: 'number' }
                }
              }
            },
            selected_seats: {
              type: 'array',
              description: 'Updated seat selections',
              items: {
                type: 'object',
                properties: {
                  event_id: { type: 'string' },
                  seat_id: { type: 'string' },
                  seat_code: { type: 'string' },
                  capacity: { type: 'number' },
                  base_price: { type: 'number' },
                  event_price: { type: 'number' },
                  available_from: { type: 'string', format: 'date-time' },
                  available_until: { type: 'string', format: 'date-time' },
                  status: { type: 'string' }
                }
              }
            },
            notes: {
              type: 'string',
              description: 'Admin notes'
            },
            client_notes: {
              type: 'string',
              description: 'Client notes'
            }
          }
        }
      },
      required: ['coe_id', 'updates']
    },
    schema_version: '1.0.0',
    permissions: isClientCOEEditingEnabled() ? ['admin', 'client'] : ['admin'],
    handler: 'handleUpdateCOE'
  },

  /**
   * Tool 4: Get My COEs
   * @description List all COEs for the current user
   */
  get_my_coes: {
    name: 'get_my_coes',
    description: 'List all COEs for the current user. Use this tool when users ask to "show me my COEs", "show me my future events", "show me all my past events", "show me my COEs", or want to see their curated experiences. Returns COE summaries with basic info, status, dates, event count, and total price. For past events, filter by date range if provided.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by COE status (optional)',
          enum: ['draft', 'approved', 'accepted', 'rejected', 'cancelled', 'expired']
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
          minimum: 1,
          maximum: 100
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
          minimum: 0
        }
      }
    },
    schema_version: '1.0.0',
    permissions: ['admin', 'client', 'runner'],
    handler: 'handleGetMyCOEs'
  },

  /**
   * Tool 5: Get COE Details
   * @description Get full details of a specific COE
   */
  get_coe_details: {
    name: 'get_coe_details',
    description: 'Get full details of a specific COE including all events, selected seats, pricing breakdown, runner assignments, payment status, and timeline dates. Use this tool when users ask for details about a specific COE or want to view a COE in detail. If coe_id is not provided, use the active_coe_id from conversation context.',
    parameters: {
      type: 'object',
      properties: {
        coe_id: {
          type: 'string',
          description: 'COE MongoDB ID'
        }
      },
      required: ['coe_id']
    },
    schema_version: '1.0.0',
    permissions: ['admin', 'client', 'runner'],
    handler: 'handleGetCOEDetails'
  },

  /**
   * Tool 6: Delete COE
   * @description Delete a COE (soft delete or hard delete based on status)
   */
  delete_coe: {
    name: 'delete_coe',
    description: 'Delete a COE. Use this tool when users ask to "delete the COE", "remove the COE", or "cancel the COE". Releases all held seats and updates event counts. Clients can only delete their own COEs if status is "draft" or "approved". Admins can delete any COE. If coe_id is not provided, use the active_coe_id from conversation context.',
    parameters: {
      type: 'object',
      properties: {
        coe_id: {
          type: 'string',
          description: 'COE MongoDB ID'
        }
      },
      required: ['coe_id']
    },
    schema_version: '1.0.0',
    permissions: ['admin', 'client'],
    handler: 'handleDeleteCOE'
  },

  /**
   * Tool 7: Get Locations
   * @description Query and list all locations (venues, restaurants, hotels, clubs)
   */
  get_locations: {
    name: 'get_locations',
    description: 'Query and list all locations (venues, restaurants, hotels, clubs). Use this tool when users ask about "locations", "show me all locations", "list venues", "show me restaurants", "show me hotels", "show me clubs", or want to see available locations. Returns locations with name, type, address, geo coordinates, and basic info.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by location type (optional)',
          enum: ['night_club', 'day_club', 'restaurant', 'hotel']
        },
        status: {
          type: 'string',
          description: 'Filter by location status (default: "active")',
          enum: ['draft', 'active', 'archived']
        },
        search: {
          type: 'string',
          description: 'Text search in location name or description (optional)'
        },
        city: {
          type: 'string',
          description: 'Filter by city (optional)'
        },
        country: {
          type: 'string',
          description: 'Filter by country (optional)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 100)',
          minimum: 1,
          maximum: 200
        }
      }
    },
    schema_version: '1.0.0',
    permissions: ['admin', 'client', 'runner'],
    handler: 'handleGetLocations'
  },

  /**
   * Tool 8: Get User Profile
   * @description Get user profile information
   */
  get_user_profile: {
    name: 'get_user_profile',
    description: 'Get user profile information. Use this tool when users ask to view a profile, show account details, or see user information. For clients, this returns their own profile. For admins and runners, can return any user\'s profile by providing user_id. If user_id is not provided, returns the current user\'s profile.',
    parameters: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'User ID (optional - defaults to current user). Only admins and runners can specify other user IDs. Clients can only view their own profile.'
        }
      }
    },
    schema_version: '1.0.0',
    permissions: ['admin', 'client', 'runner'],
    handler: 'handleGetUserProfile'
  },

  /**
   * Tool 9: Get Clients List
   * @description Get list of clients with search and pagination (admin/runner only)
   */
  get_clients: {
    name: 'get_clients',
    description: 'Get a list of clients (users with role "client"). Use this tool when admins or runners ask to search for clients, find a client profile, show client list, or look for a client by name or email. This tool supports search by name or email and pagination. Only admins and runners can use this tool.',
    parameters: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Search term to filter clients by name (firstName, lastName) or email (optional)'
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (default: 1)',
          minimum: 1,
          default: 1
        },
        limit: {
          type: 'number',
          description: 'Number of results per page (default: 20, max: 100)',
          minimum: 1,
          maximum: 100,
          default: 20
        }
      }
    },
    schema_version: '1.0.0',
    permissions: ['admin', 'runner'],
    handler: 'handleGetClients'
  },

  /**
   * Tool 10: Open Create COE Form For Client (Admin only)
   * @description Open a Create COE form for a specific client selected from the client list. Admins use this to start a COE draft for a client directly from the bot UI.
   */
  open_create_coe_for_client: {
    name: 'open_create_coe_for_client',
    description: 'Open a Create COE form for a specific client. Use this tool when an admin selects a client from the client list and wants to create a new COE draft for that client.',
    parameters: {
      type: 'object',
      properties: {
        client_id: {
          type: 'string',
          description: 'Client MongoDB ID (24-character hex string)'
        }
      },
      required: ['client_id']
    },
    schema_version: '1.0.0',
    permissions: ['admin'],
    handler: 'handleOpenCreateCOEForClient'
  }
};

/**
 * Get all tools as OpenAI function definitions
 * @returns {Array} Array of OpenAI function definitions
 */
function getOpenAIFunctions() {
  return Object.values(toolRegistry).map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

/**
 * Get tool by name
 * @param {string} toolName - Tool name
 * @returns {Object|null} Tool definition or null if not found
 */
function getTool(toolName) {
  return toolRegistry[toolName] || null;
}

/**
 * Get all tool names
 * @returns {Array<string>} Array of tool names
 */
function getAllToolNames() {
  return Object.keys(toolRegistry);
}

/**
 * Check if user has permission to use a tool
 * @param {string} toolName - Tool name
 * @param {string} userRole - User role (admin, client, runner)
 * @returns {boolean} True if user has permission
 */
function hasPermission(toolName, userRole) {
  const tool = getTool(toolName);
  if (!tool) return false;
  return tool.permissions.includes(userRole);
}

module.exports = {
  toolRegistry,
  getOpenAIFunctions,
  getTool,
  getAllToolNames,
  hasPermission
};

