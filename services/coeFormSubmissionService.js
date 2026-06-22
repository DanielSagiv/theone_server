/**
 * Deterministic COE creation from structured mobile form prompts (no OpenAI).
 * Extracted from botService form-submission Phase 2.4.
 */
const User = require('../models/User');
const coeService = require('./coeService');
const { formatDateRange } = require('../utils/dateParser');
const { normalizeCoeDatePair } = require('../utils/calendarDateOnly');
const { generateCorrelationId } = require('../utils/botUtils');
const {
  extractPreferencesFromFormSubmission,
  extractPreferenceKeywords,
  updateConversationPreferences,
} = require('./botPreferenceService');

/**
 * @param {string} prompt
 * @returns {boolean}
 */
function isExperienceFormSubmission(prompt) {
  return (
    prompt.includes('Build my experience with the following preferences:') ||
    prompt.includes('Request my experience with the following preferences:') ||
    (prompt.includes('Start date:') &&
      prompt.includes('End date:') &&
      prompt.includes('Budget:'))
  );
}

/**
 * Lazy import to avoid circular dependency at module load.
 * @returns {{ executeTool: Function, getOrCreateConversation: Function }}
 */
function getBotServiceDeps() {
  return require('./botService');
}

/**
 * Extract preferences from a formatted form prompt.
 * @param {string} prompt
 * @returns {object}
 */
function extractFormSubmission(prompt) {
  try {
    const extractionResult = extractPreferencesFromFormSubmission(prompt);
    if (!extractionResult) {
      return {
        valid: false,
        errors: ['Failed to extract preferences'],
        raw: {},
        formatted: {},
      };
    }
    return extractionResult;
  } catch (extractionError) {
    return {
      valid: false,
      errors: [`Extraction error: ${extractionError.message}`],
      raw: {},
      formatted: {},
    };
  }
}

/**
 * Run Phase 2.4 COE creation from an already-extracted form submission.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.prompt
 * @param {object} params.user
 * @param {string} params.correlationId
 * @param {object|null} params.conversation - required when updateConversation is true
 * @param {object} params.extractionResult
 * @param {object} params.extractedPreferences
 * @param {boolean} [params.updateConversation=true]
 * @returns {Promise<{handled:boolean,success?:boolean,data?:object,error?:object}>}
 */
async function processFormSubmissionPhase24(params) {
  const {
    userId,
    prompt,
    user,
    correlationId,
    conversation,
    extractionResult,
    extractedPreferences,
    updateConversation = true,
  } = params;

  const { executeTool } = getBotServiceDeps();

  const fail = (error, data) => ({
    handled: true,
    success: false,
    error,
    data: data || null,
  });

  const ok = (data) => ({ handled: true, success: true, data });

  const pushAssistant = async (assistantMessage) => {
    if (!updateConversation || !conversation) return;
    conversation.messages.push(assistantMessage);
    await conversation.save();
  };

  if (!extractionResult) {
    return { handled: false };
  }

      // If this is a CLIENT request with NO manually selected events, create a request-only COE
      // (no auto-selected events) and skip the create_coe_draft tool.
      const clientNoManualEvents =
        user.role === 'client' &&
        !(
          extractionResult.raw &&
          extractionResult.raw.selected_events &&
          Array.isArray(extractionResult.raw.selected_events) &&
          extractionResult.raw.selected_events.length > 0
        );

      if (clientNoManualEvents) {
        try {
          console.log('[BOT] Phase 2.4: Creating request-only COE (no manual events, client flow)');

          const raw = extractionResult.raw || {};

          // Build original_request_data from extracted preferences
          let requestStartDate = null;
          let requestEndDate = null;
          if (raw.start_date) {
            const pair = normalizeCoeDatePair(
              raw.start_date,
              raw.end_date || raw.start_date,
            );
            requestStartDate = pair.startDate;
            requestEndDate = pair.endDate;
          }

          // Normalize budget into { max, currency } shape used by COEOriginalRequestCard and admin flows
          let normalizedBudget = null;
          if (raw.budget) {
            const amount =
              typeof raw.budget === 'number'
                ? raw.budget
                : raw.budget.max ??
                  raw.budget.amount ??
                  null;
            if (amount != null && !Number.isNaN(Number(amount))) {
              normalizedBudget = {
                max: Number(amount),
                min:
                  raw.budget.min != null
                    ? Number(raw.budget.min)
                    : Number(amount),
                currency: raw.budget.currency || 'USD',
              };
            }
          }

          const originalRequestData = {
            original_request_text: prompt,
            budget: normalizedBudget,
            requested_dates: {
              start_date: requestStartDate,
              end_date: requestEndDate,
            },
            party_size: raw.party_size || null,
            seat_preferences: raw.seat_preferences || '',
            general_preferences: raw.specific_preferences || '',
            city: raw.city || null,
            requested_at: new Date(),
          };

          // Determine admin for this request (first active admin, fallback to any admin)
          let admin = await User.findOne({ role: 'admin', isActive: true });
          if (!admin) {
            admin = await User.findOne({ role: 'admin' });
          }
          if (!admin) {
            throw new Error('No active admin found to assign to COE request.');
          }

          const client = user;
          const start = requestStartDate || new Date();
          const end = requestEndDate || start;
          const dateStr = formatDateRange(start, end || start);

          const clientFullName =
            (client.firstName && client.lastName
              ? `${client.firstName} ${client.lastName}`
              : client.firstName) ||
            client.email ||
            'Client';

          const coeName = `${clientFullName} experience, ${dateStr}`;

          const requestCoeData = {
            name: coeName,
            description: coeName,
            status: 'request',
            client_id: client._id,
            admin_id: admin._id,
            currency: normalizedBudget?.currency || 'USD',
            subtotal: 0,
            taxes: 0,
            fees: 0,
            total: 0,
            events: [],
            selected_seats: [],
            start_date: start,
            end_date: end,
            original_request_data: originalRequestData,
          };

          const coe = await coeService.createCOE(requestCoeData, user._id);

          console.log('[BOT] Phase 2.4: Request-only COE created:', {
            coeId: coe._id?.toString(),
            status: coe.status,
          });

          // Admin notification for request COEs is sent inside coeService.createCOE.

          // Link this COE to the conversation so later flows can find it
          if (conversation && updateConversation) {
            conversation.active_coe_id = coe._id.toString();
          }

          const confirmationMessage = {
            role: 'assistant',
            content:
              'Your experience request has been submitted. Our team will now build the best experience for you and send you a draft to review.',
            timestamp: new Date().toISOString(),
          };

          await pushAssistant(confirmationMessage);
          return ok({
            type: 'coe_request_submitted',
            coe_id: coe._id.toString(),
            status: coe.status,
            message: confirmationMessage.content,
          });
        } catch (err) {
          console.error('[BOT] Phase 2.4: Error creating request-only COE:', err);
          if (!updateConversation) {
            return fail({ code: 'SUBMIT_FAILED', message: err.message || 'Failed to create request COE' });
          }
          throw err;
        }
      }
      // CRITICAL: Check for admin without client_id BEFORE preparing tool params
      // This check must happen even if extractionResult.valid is false
      if (user.role === 'admin' && !extractionResult?.raw?.client_id) {
        console.warn('[BOT] Phase 2.4: Admin attempting COE creation without client_id - intercepting BEFORE tool preparation');
        console.log('[BOT] Phase 2.4: Extraction result:', JSON.stringify(extractionResult, null, 2));
        
        // Store preferences for later use after client is selected
        try {
          await updateConversationPreferences(userId, extractedPreferences, 'preference_collected');
        } catch (err) {
          console.error('[BOT] Error storing preferences:', err);
        }
        
        // Return a response asking admin to select a client
        const responseMessage = {
          role: 'assistant',
          content: 'I need to know which client this experience is for. Please select a client from the list below, or type "show me clients" to see all available clients.',
          structured_data: {
            type: 'text',
            message: 'I need to know which client this experience is for. Please select a client from the list below, or type "show me clients" to see all available clients.'
          },
          timestamp: new Date().toISOString()
        };
        
        // Add assistant response (user message was already added earlier)
        await pushAssistant(responseMessage);
        
        // Trigger get_clients tool automatically to show client list
        try {
          const clientsResult = await executeTool('get_clients', {}, user, correlationId);
          if (clientsResult.success && clientsResult.data) {
            const clientsResponse = {
              role: 'assistant',
              content: 'Here are the available clients:',
              structured_data: clientsResult.data,
              timestamp: new Date().toISOString()
            };
            await pushAssistant(clientsResponse);
          }
        } catch (err) {
          console.error('[BOT] Error fetching clients list:', err);
        }
        
        // Return updated conversation - THIS MUST EXIT THE FUNCTION
        console.log('[BOT] Phase 2.4: Returning early - admin needs to select client first');
                return fail(
          { code: 'CLIENT_REQUIRED', message: 'Admin must select a client for this experience.' },
          { type: 'admin_client_required' }
        );
      }
      
      // Proceed with COE creation (client_id check passed above for admin)
      // Note: Even if extractionResult.valid is false, we can proceed if client_id is present for admin
      // Date validation will happen in handleCreateCOEDraft
      try {
        console.log('[BOT] Phase 2.4: Auto-triggering COE creation from form submission...');
        
        // Safety check: ensure extractionResult has raw data
        if (!extractionResult || !extractionResult.raw) {
          console.error('[BOT] Phase 2.4: extractionResult or extractionResult.raw is missing, cannot proceed with COE creation');
          throw new Error('Failed to extract preferences from form submission');
        }
        
        // Prepare tool parameters for create_coe_draft
        const extractedBudget = extractionResult.raw.budget?.amount || 0;
        console.log('[BOT] [COE_CREATION_DEBUG] Budget extraction from form:', {
          hasBudget: !!extractionResult.raw.budget,
          budgetAmount: extractedBudget,
          budgetObject: extractionResult.raw.budget,
          rawBudget: extractionResult.raw.budget,
          extractionResultRaw: JSON.stringify(extractionResult.raw, null, 2)
        });
        
        const toolParams = {
          start_date: extractionResult.raw.start_date,
          end_date: extractionResult.raw.end_date,
          preferences: {
            city: extractionResult.raw.city || null, // Add city directly for handleCreateCOEDraft
            budget_range: {
              max: extractedBudget
            },
            location_preferences: extractionResult.raw.city ? [extractionResult.raw.city] : [],
            party_size: extractionResult.raw.party_size,
            preferences: extractPreferenceKeywords(
              extractionResult.raw.seat_preferences || '',
              extractionResult.raw.specific_preferences || ''
            ),
            notes: `${extractionResult.raw.seat_preferences || ''}\n${extractionResult.raw.specific_preferences || ''}`.trim(),
            // Include full preference data for Phase 2.3 sentiment matching
            seat_preferences: extractionResult.raw.seat_preferences || '',
            specific_preferences: extractionResult.raw.specific_preferences || ''
          }
        };
        
        // If user selected specific events on the client, pass them through to create_coe_draft
        if (
          extractionResult.raw.selected_events &&
          Array.isArray(extractionResult.raw.selected_events) &&
          extractionResult.raw.selected_events.length > 0
        ) {
          const categoryByEventId = {};
          if (
            extractionResult.raw.selected_seat_categories &&
            Array.isArray(extractionResult.raw.selected_seat_categories)
          ) {
            for (const { event_id, seat_category } of extractionResult.raw.selected_seat_categories) {
              const id = (event_id && event_id.toString && event_id.toString()) || event_id;
              if (id) categoryByEventId[id] = seat_category;
            }
          }
          const jointByEventId = {};
          if (
            extractionResult.raw.selected_simple_joint_prices &&
            Array.isArray(extractionResult.raw.selected_simple_joint_prices)
          ) {
            for (const row of extractionResult.raw.selected_simple_joint_prices) {
              const jid =
                (row.event_id &&
                  row.event_id.toString &&
                  row.event_id.toString()) ||
                String(row.event_id || '');
              if (jid) {
                const mp = Number(row.manual_price);
                const fp =
                  row.the1_fee_percent != null &&
                  Number.isFinite(Number(row.the1_fee_percent))
                    ? Math.min(100, Math.max(0, Number(row.the1_fee_percent)))
                    : null;
                jointByEventId[jid] = {
                  manual_price: mp,
                  the1_fee_percent: fp
                };
              }
            }
          }
          const the1ByEventId = {};
          if (
            extractionResult.raw.selected_the1_negotiated_pricing &&
            Array.isArray(extractionResult.raw.selected_the1_negotiated_pricing)
          ) {
            for (const row of extractionResult.raw.selected_the1_negotiated_pricing) {
              const tid =
                (row.event_id &&
                  row.event_id.toString &&
                  row.event_id.toString()) ||
                String(row.event_id || '');
              if (tid) {
                the1ByEventId[tid] = {
                  venue_catalog_price:
                    row.venue_catalog_price != null
                      ? Number(row.venue_catalog_price)
                      : null,
                  the1_base_price: Number(row.the1_base_price),
                  the1_fee_percent: Number(row.the1_fee_percent)
                };
              }
            }
          }
          toolParams.events = extractionResult.raw.selected_events.map(eventId => {
            const id = (eventId && eventId.toString && eventId.toString()) || eventId;
            const jp = jointByEventId[id];
            const t1 = the1ByEventId[id];
            const jpManual =
              jp && typeof jp === 'object'
                ? jp.manual_price
                : jp != null
                  ? Number(jp)
                  : null;
            const jpFee =
              jp && typeof jp === 'object' && jp.the1_fee_percent != null
                ? jp.the1_fee_percent
                : null;
            return {
              event_id: eventId,
              selected_seats: [],
              preferred_seat_category: categoryByEventId[id] || null,
              simple_joint_manual_price:
                jpManual != null && Number.isFinite(jpManual) && jpManual >= 0
                  ? jpManual
                  : null,
              /** When simple joint is set, optional THE1 fee % (defaults server-side if null). */
              simple_joint_the1_fee_percent:
                jpFee != null && Number.isFinite(Number(jpFee))
                  ? Math.min(100, Number(jpFee))
                  : null,
              the1_pricing:
                t1 &&
                t1.the1_base_price != null &&
                Number.isFinite(Number(t1.the1_base_price))
                  ? {
                      venue_catalog_price:
                        t1.venue_catalog_price != null &&
                        Number.isFinite(Number(t1.venue_catalog_price))
                          ? Number(t1.venue_catalog_price)
                          : null,
                      the1_base_price: Number(t1.the1_base_price),
                      the1_fee_percent:
                        t1.the1_fee_percent != null &&
                        Number.isFinite(Number(t1.the1_fee_percent))
                          ? Number(t1.the1_fee_percent)
                          : 20
                    }
                  : null
            };
          });
          // Treat manual event selection differently for clients vs admins by default:
          // - Clients: manual_event_selection=true → if no seats are available, surface a clear error.
          // - Admins: manual_event_selection=false → allow fallback/alternative search logic to run.
          toolParams.manual_event_selection = user.role === 'client';
        }

        // If this form submission comes from the Flow A "Build experience" path,
        // a request_coe_id will be present. In that case:
        // - Pass request_coe_id through to create_coe_draft so it can upgrade the
        //   existing request-only COE instead of creating a new one.
        // - Force manual_event_selection=true when explicit events were chosen,
        //   so that if any selected event has no seats, we surface a clear error
        //   instead of silently dropping it (fixing the "one event with no seats" issue).
        if (extractionResult.raw.request_coe_id) {
          toolParams.request_coe_id = extractionResult.raw.request_coe_id;
          console.log('[BOT] [COE_CREATION_DEBUG] Flow A detected - using request_coe_id for draft upgrade:', {
            request_coe_id: toolParams.request_coe_id
          });

          if (toolParams.events && Array.isArray(toolParams.events) && toolParams.events.length > 0) {
            toolParams.manual_event_selection = true;
            console.log('[BOT] [COE_CREATION_DEBUG] Flow A manual selection - forcing manual_event_selection=true');
          }
        }

        console.log('[BOT] [COE_CREATION_DEBUG] Tool params prepared:', {
          start_date: toolParams.start_date,
          end_date: toolParams.end_date,
          city: toolParams.preferences.city,
          budget_max: toolParams.preferences.budget_range.max,
          party_size: toolParams.preferences.party_size,
          fullPreferences: JSON.stringify(toolParams.preferences, null, 2),
          providedEventsCount: toolParams.events?.length || 0
        });
        
        // Add client_id if user is admin (required for admin)
        if (user.role === 'admin') {
          // Extract client_id from form submission (admin COE creation flow)
          const clientId = extractionResult?.raw?.client_id;
          console.log('[BOT] Phase 2.4: Checking client_id for admin:', { 
            hasExtractionResult: !!extractionResult,
            hasRaw: !!extractionResult?.raw,
            clientId: clientId,
            clientIdType: typeof clientId
          });
          
          if (clientId && clientId.trim && clientId.trim().length > 0) {
            toolParams.client_id = clientId.trim();
            console.log('[BOT] Phase 2.4: Extracted client_id from form submission:', toolParams.client_id);
          } else {
            console.warn('[BOT] Phase 2.4: Admin COE creation but client_id not found in form submission - BLOCKING tool execution');
            // For admin users, if client_id is missing, don't call the tool
            // Instead, ask them to select a client first
            console.log('[BOT] Phase 2.4: Admin attempting to create COE without client_id - prompting for client selection and RETURNING EARLY');
            
            // Store preferences for later use after client is selected
            await updateConversationPreferences(userId, extractedPreferences, 'preference_collected');
            
            // Return a response asking admin to select a client
            const responseMessage = {
              role: 'assistant',
              content: 'I need to know which client this experience is for. Please select a client from the list below, or type "show me clients" to see all available clients.',
              structured_data: {
                type: 'text',
                message: 'I need to know which client this experience is for. Please select a client from the list below, or type "show me clients" to see all available clients.'
              },
              timestamp: new Date().toISOString()
            };
            
            // Add assistant response (user message was already added earlier)
            await pushAssistant(responseMessage);
            
            // Trigger get_clients tool automatically to show client list
            try {
              const clientsResult = await executeTool('get_clients', {}, user, correlationId);
              if (clientsResult.success && clientsResult.data) {
                const clientsResponse = {
                  role: 'assistant',
                  content: 'Here are the available clients:',
                  structured_data: clientsResult.data,
                  timestamp: new Date().toISOString()
                };
                await pushAssistant(clientsResponse);
              }
            } catch (err) {
              console.error('[BOT] Error fetching clients list:', err);
            }
            
            // Return updated conversation - THIS MUST EXIT THE FUNCTION
            console.log('[BOT] Phase 2.4: Returning early from form submission path to prevent COE creation');
                    return fail(
          { code: 'CLIENT_REQUIRED', message: 'Admin must select a client for this experience.' },
          { type: 'admin_client_required' }
        );
          }
        } else if (user.role === 'client') {
          // Client creates COE for themselves
          toolParams.client_id = user._id.toString();
        }

        // Admin-only: skip draft and publish as approved (proposal) with deposit + payment window — same outcome as manual Propose (not used when upgrading a request COE).
        if (
          user.role === 'admin' &&
          !extractionResult.raw.request_coe_id &&
          extractionResult.raw.admin_create_mode === 'proposal'
        ) {
          toolParams.admin_create_as_proposal = true;
          if (typeof extractionResult.raw.proposal_deposit_percent === 'number') {
            toolParams.proposal_deposit_percent = extractionResult.raw.proposal_deposit_percent;
          }
        }
        
        // ADDITIONAL SAFETY CHECK: Don't proceed if admin and no client_id
        if (user.role === 'admin' && !toolParams.client_id) {
          console.error('[BOT] Phase 2.4: SAFETY CHECK FAILED - Admin has no client_id but we reached tool execution. This should not happen!');
          throw new Error('Admin must provide client_id when creating a COE. This error should have been caught earlier.');
        }
        
        console.log('[BOT] Phase 2.4: Calling create_coe_draft tool with params:', {
          client_id: toolParams.client_id,
          start_date: toolParams.start_date,
          end_date: toolParams.end_date,
          city: extractionResult.raw.city,
          budget: extractionResult.raw.budget?.amount,
          party_size: toolParams.preferences.party_size
        });
        
        // Execute create_coe_draft tool
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] ========== EXECUTING create_coe_draft TOOL ==========');
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Tool execution start:', {
          toolName: 'create_coe_draft',
          correlationId: correlationId,
          userId: user._id?.toString(),
          userRole: user.role,
          toolParamsFull: JSON.stringify(toolParams, null, 2)
        });
        
        const toolResult = await executeTool('create_coe_draft', toolParams, user, correlationId);
        
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Tool execution complete:', {
          success: toolResult.success,
          hasData: !!toolResult.data,
          message: toolResult.message,
          error: toolResult.error,
          dataType: toolResult.data?.type
        });
        
        if (toolResult.success && toolResult.data) {
          console.log('[BOT] [COE_CREATION_FULL_DEBUG] ✅ COE draft created successfully');
          console.log('[BOT] Phase 2.4: ✅ COE draft created successfully');
          
          // toolResult.data is already a formatted structured response from handleCreateCOEDraft
          const coeResponse = toolResult.data;
          
          // Extract COE ID from the response (could be in coe.coe_id or coe.id)
          const coeId = coeResponse.coe_id || coeResponse.coe?.id || coeResponse.coe?._id;
          console.log('[BOT] [COE_CREATION_FULL_DEBUG] Extracting COE ID from response:', {
            coeResponseKeys: Object.keys(coeResponse),
            coeIdFromCoeId: coeResponse.coe_id,
            coeIdFromCoeIdField: coeResponse.coe?.id,
            coeIdFromCoe_idField: coeResponse.coe?._id,
            finalCoeId: coeId,
            coeIdType: typeof coeId
          });
          
          if (coeId && conversation && updateConversation) {
            conversation.active_coe_id = typeof coeId === 'string' ? coeId : coeId.toString();
            await conversation.save();
            console.log('[BOT] [COE_CREATION_FULL_DEBUG] COE ID saved to conversation:', {
              conversationId: conversation._id.toString(),
              activeCoeId: conversation.active_coe_id
            });
          } else {
            console.warn('[BOT] [COE_CREATION_FULL_DEBUG] WARNING: No COE ID found in response');
          }
          
          // Add assistant message with structured COE response
          const assistantMessage = {
            role: 'assistant',
            content: coeResponse.message || toolResult.message || 'Your experience draft has been created!',
            structured_data: coeResponse
          };
          await pushAssistant(assistantMessage);
          
          console.log('[BOT] Phase 2.4: ✅ Returning draft COE response');
          return ok(coeResponse);
        } else {
          console.error('[BOT] Phase 2.4: COE creation failed:', toolResult.error);
          
          // If error response has structured data (NO_SEATS_AVAILABLE), use it
          if (toolResult.data && toolResult.data.type === 'error') {
            const errorResponse = toolResult.data;
            
            // Add assistant message with error response
            const assistantMessage = {
              role: 'assistant',
              content: errorResponse.message || 'We couldn\'t find any available seats/tables matching your preferences.',
              structured_data: errorResponse
            };
            await pushAssistant(assistantMessage);
            
            console.log('[BOT] Phase 2.4: Returning error response to user');
            return fail(
              { code: errorResponse.code || 'COE_CREATION_FAILED', message: errorResponse.message || 'No seats available' },
              errorResponse
            );
          }
          // Continue to normal flow - let OpenAI handle the error or provide feedback
          const errorMessage = {
            role: 'assistant',
            content: `I encountered an issue creating your experience: ${toolResult.error?.message || 'Unknown error'}. Please try again or contact support.`
          };
          await pushAssistant(errorMessage);
          return fail({
            code: 'COE_CREATION_FAILED',
            message: toolResult.error?.message || 'Unknown error',
          });
        }
      } catch (error) {
        console.error('[BOT] Phase 2.4: Error in auto-trigger COE creation:', error);
        if (!updateConversation) {
          return fail({ code: 'SUBMIT_FAILED', message: error.message || 'COE creation failed' });
        }
      }

  return { handled: false };
}

/**
 * Submit experience from mobile formatted prompt (API entry — no bot conversation).
 * @param {object} user
 * @param {string} prompt
 * @param {string|null} correlationId
 * @returns {Promise<{success:boolean,data?:object,error?:object}>}
 */
async function submitExperienceFromFormattedPrompt(user, prompt, correlationId = null) {
  if (!isExperienceFormSubmission(prompt)) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Prompt is not a structured experience form submission',
      },
    };
  }

  if (!correlationId) {
    correlationId = generateCorrelationId();
  }

  const extractionResult = extractFormSubmission(prompt);
  const userId = user._id || user.id;

  const phaseResult = await processFormSubmissionPhase24({
    userId,
    prompt,
    user,
    correlationId,
    conversation: null,
    extractionResult,
    extractedPreferences: extractionResult.formatted || {},
    updateConversation: false,
  });

  if (!phaseResult.handled) {
    return {
      success: false,
      error: {
        code: 'SUBMIT_FAILED',
        message: 'Form submission could not be processed',
      },
    };
  }

  if (phaseResult.success === false) {
    return {
      success: false,
      error: phaseResult.error || { code: 'SUBMIT_FAILED', message: 'Submission failed' },
      data: phaseResult.data || undefined,
    };
  }

  return { success: true, data: phaseResult.data };
}

module.exports = {
  isExperienceFormSubmission,
  extractFormSubmission,
  processFormSubmissionPhase24,
  submitExperienceFromFormattedPrompt,
};
