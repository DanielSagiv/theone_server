/**
 * Event Seat Service
 * Fetches event seats with AI-generated sentiment summaries
 */
const Event = require('../models/Event');
const Location = require('../models/Location');
const { generateSeatRecommendation } = require('./seatRecommendationService');

/**
 * Get event seats with AI-generated sentiment summaries
 * @param {string} eventId - Event ID
 * @param {Object} options - Options for fetching
 * @returns {Promise<Object>} Event with seats and summaries
 */
async function getEventSeatsWithSummaries(eventId, options = {}) {
  try {
    // 1. Fetch event with location populated
    const event = await Event.findById(eventId)
      .populate({
        path: 'location_id',
        select: 'name type address geo media sentiment'
      })
      .lean();

    if (!event) {
      throw new Error('Event not found');
    }

    if (!event.location_id || !event.location_id._id) {
      throw new Error('Event location not found');
    }

    // 2. Get location to access seat sentiments
    const locationId = event.location_id._id || event.location_id;
    const location = await Location.findById(locationId)
      .select('seats')
      .lean();

    if (!location) {
      throw new Error('Location not found');
    }

    // 3. Create a map of location seats by _id for quick lookup
    const locationSeatMap = new Map();
    location.seats.forEach(seat => {
      locationSeatMap.set(seat._id.toString(), seat);
    });

    // When available_only, filter to seats with status 'available' before processing
    const seatsToProcess = options.available_only
      ? (event.seats || []).filter(s => s.status === 'available')
      : (event.seats || []);

    // 4. Process event seats and generate AI summaries
    const seatsWithSummaries = await Promise.all(
      seatsToProcess.map(async (eventSeat) => {
        // Find corresponding location seat to get sentiments and media
        const locationSeat = locationSeatMap.get(eventSeat.seat_id?.toString());
        const sentiments = locationSeat?.sentiment || [];

        // Get media: prioritize event seat media, fallback to location seat media
        let seatMedia = [];
        if (eventSeat.media && Array.isArray(eventSeat.media) && eventSeat.media.length > 0) {
          seatMedia = eventSeat.media;
        } else if (locationSeat?.media && Array.isArray(locationSeat.media) && locationSeat.media.length > 0) {
          // Inherit media from location seat if event seat doesn't have media
          seatMedia = locationSeat.media;
        }

        // Prepare seat data for AI recommendation
        const seatData = {
          code: eventSeat.code,
          category: eventSeat.category,
          section: eventSeat.section,
          capacity: eventSeat.capacity,
          event_price: eventSeat.event_price,
          base_price: eventSeat.min_spend || 0,
        };

        // Generate AI summary
        let sentimentSummary = 'Premium seating option with excellent amenities';
        if (sentiments.length > 0) {
          try {
            const locId = event.location_id._id?.toString() || event.location_id?.toString() || locationId.toString();
            sentimentSummary = await generateSeatRecommendation(
              seatData,
              sentiments,
              locId,
              {}, // No user preferences for general viewing
              { useCache: true, timeout: 5000 }
            );
          } catch (error) {
            console.error('[EventSeatService] Error generating summary for seat:', {
              seatCode: eventSeat.code,
              error: error.message
            });
            // Use fallback text
          }
        }

        return {
          id: eventSeat._id?.toString() || eventSeat._id,
          code: eventSeat.code,
          label: eventSeat.label,
          category: eventSeat.category,
          section: eventSeat.section,
          capacity: eventSeat.capacity || 0,
          event_price: eventSeat.event_price || 0,
          status: eventSeat.status || 'available',
          media: seatMedia, // Use inherited media (event or location)
          sentiment_summary: sentimentSummary,
          sentiments: sentiments, // Include raw sentiments for debugging
          booked_by: eventSeat.booked_by?.toString() || null,
          booked_at: eventSeat.booked_at || null,
        };
      })
    );

    // 5. Calculate summary statistics
    const summary = {
      total_seats: seatsWithSummaries.length,
      available_count: seatsWithSummaries.filter(s => s.status === 'available').length,
      held_count: seatsWithSummaries.filter(s => s.status === 'held').length,
      booked_count: seatsWithSummaries.filter(s => s.status === 'booked').length,
      blocked_count: seatsWithSummaries.filter(s => s.status === 'blocked').length,
    };

    // 6. Format event data
    const eventData = {
      id: event._id.toString(),
      name: event.name,
      description: event.description,
      start_datetime: event.start_datetime,
      end_datetime: event.end_datetime,
      media: event.media || [],
      location: {
        id: event.location_id._id.toString(),
        name: event.location_id.name,
        type: event.location_id.type,
        address: event.location_id.address || null,
        media: event.location_id.media || []
      }
    };

    return {
      event: eventData,
      seats: seatsWithSummaries,
      summary
    };
  } catch (error) {
    console.error('[EventSeatService] Error getting event seats:', error);
    throw error;
  }
}

module.exports = {
  getEventSeatsWithSummaries
};

