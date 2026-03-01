const Event = require('../models/Event');
const Location = require('../models/Location');

/**
 * City display name -> possible DB values (e.g. locations may store "LV" not "Las Vegas")
 */
const CITY_ALIASES = {
  'las vegas': ['LV', 'Las Vegas', 'Las Vegas, NV'],
  'new york': ['NYC', 'New York', 'New York City'],
  'la': ['LA', 'Los Angeles'],
  'miami': ['Miami', 'Miami Beach'],
};

/**
 * Event Search Service
 * @description Centralized service for building flexible event queries based on search parameters
 */

/**
 * Search events based on flexible parameters
 * @param {Object} searchParams - Search criteria
 * @param {Object} options - Query options (pagination, sorting, etc.)
 * @returns {Promise<Object>} Search results with events and pagination
 */
async function searchEvents(searchParams, options = {}) {
  try {
    const {
      city,
      location_name,
      performer,
      start_date,
      end_date,
      status = 'active'
    } = searchParams;

    const {
      limit = 100,
      skip = 0,
      sort = { start_datetime: 1 }
    } = options;

    console.log('[EventSearchService] Searching events with params:', {
      city,
      location_name,
      performer,
      start_date,
      end_date,
      status,
      limit,
      skip
    });

    // Build base filter
    const filter = {};

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Date range filter
    if (start_date || end_date) {
      filter.start_datetime = {};
      if (start_date) {
        const startDate = new Date(start_date);
        if (!isNaN(startDate.getTime())) {
          filter.start_datetime.$gte = startDate;
        }
      }
      if (end_date) {
        const endDate = new Date(end_date);
        if (!isNaN(endDate.getTime())) {
          filter.start_datetime.$lte = endDate;
        }
      }
    } else {
      // Default: only upcoming events if no date specified
      filter.start_datetime = { $gte: new Date() };
    }

    // Location filter (city or venue) - when neither is set, no location filter (all events in date range)
    if (city || location_name) {
      const locationFilter = {};

      // City: match the search term OR any alias (e.g. "Las Vegas" also matches "LV" so Tao is included)
      if (city) {
        const cityKey = city.trim().toLowerCase();
        const cityValues = [city.trim()];
        const aliases = CITY_ALIASES[cityKey];
        if (aliases && Array.isArray(aliases)) {
          aliases.forEach(a => { if (a && !cityValues.some(c => c.toLowerCase() === a.toLowerCase())) cityValues.push(a); });
        }
        locationFilter.$or = cityValues.map(c => ({ 'address.city': { $regex: c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }));
      }

      if (location_name) {
        locationFilter.name = { $regex: location_name.trim(), $options: 'i' };
      }

      let locations = await Location.find(locationFilter).select('_id');

      if (locations.length > 0) {
        filter.location_id = { $in: locations.map(loc => loc._id) };
        console.log('[EventSearchService] Found locations:', {
          count: locations.length,
          location_ids: locations.map(l => l._id.toString())
        });
      } else {
        // No matching locations found, return empty result
        console.log('[EventSearchService] No matching locations found for city=', city, 'location_name=', location_name);
        return {
          events: [],
          total: 0,
          pagination: {
            page: Math.floor(skip / limit) + 1,
            limit,
            total: 0,
            pages: 0
          }
        };
      }
    }

    // Performer filter
    // Note: Currently Event model only stores perfcode, not performer names
    // We'll search by perfcode if it matches, or use text search on event name/description
    if (performer) {
      filter.$or = [
        { 'performers.perfcode': { $regex: performer, $options: 'i' } },
        { name: { $regex: performer, $options: 'i' } },
        { description: { $regex: performer, $options: 'i' } }
      ];
      console.log('[EventSearchService] Searching for performer:', performer);
    }

    console.log('[EventSearchService] Final filter:', JSON.stringify(filter, null, 2));

    // Execute query
    // Note: Using lean() for better JSON serialization, but ensure populate works correctly
    const [events, total] = await Promise.all([
      Event.find(filter)
        .populate({
          path: 'location_id',
          select: 'name type address geo media sentiment'
        })
        .select('name description type start_datetime end_datetime base_price currency status media seats performers')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(), // Use lean() to get plain objects for better JSON serialization
      Event.countDocuments(filter)
    ]);

    // Inherit media from location if event doesn't have media (for display purposes)
    events.forEach(event => {
      // Ensure media is an array
      if (!event.media || !Array.isArray(event.media)) {
        event.media = [];
      }
      
      // If event has no media, inherit from location
      if (event.media.length === 0 && event.location_id && event.location_id.media) {
        // Create a copy of location media to avoid modifying the original
        event.media = Array.isArray(event.location_id.media) 
          ? [...event.location_id.media] 
          : [];
      }
      
      // Ensure media array contains valid objects with url
      if (event.media && Array.isArray(event.media)) {
        event.media = event.media.filter(m => m && m.url && typeof m.url === 'string');
      }
    });

    console.log('[EventSearchService] Sample event media check:', {
      sampleEvent: events.length > 0 ? {
        name: events[0].name,
        hasMedia: !!events[0].media,
        mediaCount: events[0].media?.length || 0,
        mediaUrls: events[0].media?.map(m => m?.url).filter(Boolean) || [],
        hasLocationMedia: !!events[0].location_id?.media,
        locationMediaCount: events[0].location_id?.media?.length || 0,
        locationMediaUrls: events[0].location_id?.media?.map(m => m?.url).filter(Boolean) || []
      } : null
    });

    console.log('[EventSearchService] Search results:', {
      eventsFound: events.length,
      total
    });

    return {
      events,
      total,
      pagination: {
        page: Math.floor(skip / limit) + 1,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('[EventSearchService] Error searching events:', error);
    throw error;
  }
}

module.exports = {
  searchEvents
};

