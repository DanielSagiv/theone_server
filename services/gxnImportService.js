const Location = require('../models/Location');
const Event = require('../models/Event');
const { inheritSeatsFromLocation } = require('./locationEventService');

/**
 * Map GXN venue type to THE1 location type
 * @param {string} gxnType - GXN venue type
 * @returns {string|null} - THE1 location type or null if unsupported
 */
function mapVenueType(gxnType) {
  if (!gxnType) return null;
  
  const typeMap = {
    'nightclub': 'night_club',
    'night club': 'night_club',
    'dayclub': 'day_club',
    'day club': 'day_club',
    'pool': 'day_club', // Pool venues map to day_club
    'restaurant': 'restaurant',
    'hotel': 'hotel'
  };
  
  const normalized = gxnType.toLowerCase().trim();
  return typeMap[normalized] || null;
}

/**
 * Extract venue media from GXN images object
 * @param {Object} images - GXN images object
 * @returns {Array} - Array of media objects
 */
function extractVenueMedia(images) {
  const media = [];
  let order = 0;
  
  if (!images || typeof images !== 'object') return media;
  
  // Iterate through image types and take first image of each type
  for (const [imageType, imageArray] of Object.entries(images)) {
    if (Array.isArray(imageArray) && imageArray.length > 0 && order < 5) {
      const img = imageArray[0];
      if (img.path && img.file) {
        media.push({
          type: 'image',
          url: `${img.path}/${img.file}`,
          caption: img.imagetypename || '',
          order: order++
        });
      }
    }
  }
  
  return media;
}

/**
 * Extract social media links from GXN socials array
 * @param {Array|null} socials - GXN socials array (can be null)
 * @returns {Array} - Array of social media objects
 */
function extractSocials(socials) {
  if (!socials || !Array.isArray(socials)) return [];
  
  return socials.map(social => ({
    linktype: social.linktype || '',
    url: social.url || '',
    linktypecode: social.linktypecode || ''
  })).filter(social => social.url); // Only include entries with URLs
}

/**
 * Simplify GXN operating hours structure
 * @param {Object} currentophours - GXN current operating hours object
 * @returns {Object|null} - Simplified operating hours object
 */
function simplifyOperatingHours(currentophours) {
  if (!currentophours || typeof currentophours !== 'object') return null;
  
  const simplified = {
    weekstring: currentophours.weekstring || null,
    weekdays: []
  };
  
  // Extract weekday information if available
  if (currentophours.weekdays && typeof currentophours.weekdays === 'object') {
    // GXN structure has WD1, WD2, etc. with arrays
    for (const [dayKey, dayArray] of Object.entries(currentophours.weekdays)) {
      if (Array.isArray(dayArray) && dayArray.length > 0) {
        const dayData = dayArray[0];
        if (dayData.weekday && dayData.timestring) {
          // Convert nopentime/nclosetime (seconds since midnight) to HH:mm format
          const openSeconds = parseInt(dayData.nopentime) || 0;
          const closeSeconds = parseInt(dayData.nclosetime) || 0;
          const openHours = Math.floor(openSeconds / 3600);
          const openMins = Math.floor((openSeconds % 3600) / 60);
          const closeHours = Math.floor(closeSeconds / 3600);
          const closeMins = Math.floor((closeSeconds % 3600) / 60);
          
          simplified.weekdays.push({
            weekday: parseInt(dayData.weekday) || 1,
            openTime: `${String(openHours).padStart(2, '0')}:${String(openMins).padStart(2, '0')}`,
            closeTime: `${String(closeHours).padStart(2, '0')}:${String(closeMins).padStart(2, '0')}`,
            timestring: dayData.timestring || ''
          });
        }
      }
    }
  }
  
  // Return null if no useful data extracted
  if (!simplified.weekstring && simplified.weekdays.length === 0) {
    return null;
  }
  
  return simplified;
}

/**
 * Extract seats from GXN items where globaltype = "seating"
 * @param {Object} items - GXN items object
 * @param {string} venueCode - GXN venue code to filter items
 * @returns {Array} - Array of seat objects
 */
function extractSeatsFromItems(items, venueCode) {
  const seats = [];
  
  if (!items || typeof items !== 'object') return seats;
  
  // Category mapping based on itemname patterns
  const categoryMap = {
    'dance floor': 'lower_dance',
    'upper dance': 'upper_dance',
    'tier 3': 'third_tier_couch',
    'fourth tier': 'large_3rd_tier_couch',
    'back wall': 'backwall',
    'best available': 'stage_tables'
  };
  
  // Map itemname to category
  function mapToCategory(itemname) {
    if (!itemname) return 'stage_tables'; // default
    const lowerName = itemname.toLowerCase();
    for (const [key, category] of Object.entries(categoryMap)) {
      if (lowerName.includes(key)) {
        return category;
      }
    }
    return 'stage_tables'; // default
  }
  
  for (const [itemCode, item] of Object.entries(items)) {
    // Only process seating items for this venue
    if (item.globaltype === 'seating' && item.venuecode === venueCode) {
      const seat = {
        code: item.itemname || itemCode.slice(0, 20), // Use itemname as code, truncate if needed
        label: item.itemname || '',
        category: mapToCategory(item.itemname),
        section: item.econame || '',
        capacity: parseInt(item.capacity) || 0,
        minSpendUSD: parseFloat(item.listprice) || 0,
        priceTier: 1, // Default, can be enhanced later
        media: [],
        // Store GXN IDs for matching and syncing
        gxnItemCode: item.mastercode || itemCode || '', // GXN item mastercode
        gxnMasterItemCode: item.masteritemcode || '' // GXN catalog master code
      };
      
      seats.push(seat);
    }
  }
  
  return seats;
}

/**
 * Import venues from GXN data into THE1 Location records
 * @param {Object} gxnData - Full GXN response data
 * @param {string} userId - Admin user ID performing import
 * @returns {Promise<Object>} Import results
 */
async function importVenuesFromGXN(gxnData, userId) {
  const venues = gxnData?.data?.venues || {};
  const items = gxnData?.data?.items || {};
  const results = { success: [], failed: [], skipped: [] };
  
  for (const [venueCode, venueData] of Object.entries(venues)) {
    try {
      const info = venueData?.info;
      if (!info) {
        results.skipped.push({ venueCode, reason: 'Missing venue info' });
        continue;
      }
      
      // Skip venue categories (like "Nightlife/Daylife", "Pools at Resorts World")
      // These are not actual venues but groupings
      if (!info.address || info.address === '' || (!info.lat && !info.lon) || (info.lat === 0 && info.lon === 0)) {
        results.skipped.push({ venueCode, reason: 'Venue category, not a physical venue' });
        continue;
      }
      
      // Map venue type
      const mappedType = mapVenueType(info.venuetype);
      if (!mappedType) {
        results.skipped.push({ venueCode, reason: `Unsupported venue type: ${info.venuetype}` });
        continue;
      }
      
      // Check if location already exists (by GXN venue code)
      const existing = await Location.findOne({ gxnVenueCode: venueCode });
      if (existing) {
        results.skipped.push({ venueCode, reason: 'Location already exists', locationId: existing._id });
        continue;
      }
      
      // Extract seats from items for this venue
      const seats = extractSeatsFromItems(items, venueCode);
      
      // Build location object
      const locationData = {
        type: mappedType,
        name: info.name || `Venue ${venueCode}`,
        description: info.descr || '',
        address: {
          line1: info.address || '',
          city: info.city || '',
          state: info.province || info.state || '',
          country: info.country || '',
          postalCode: info.zip || ''
        },
        geo: {
          type: 'Point',
          coordinates: [
            parseFloat(info.lon) || 0,
            parseFloat(info.lat) || 0
          ]
        },
        contact: {
          name: info.propertyname || '',
          phone: info.phone || '',
          website: info.websiteurl || '',
          email: info.email || ''
        },
        media: extractVenueMedia(venueData.images),
        tags: [info.marketarea].filter(Boolean), // Store market area in tags, venue code in gxnVenueCode
        gxnVenueCode: venueCode, // Store GXN venue code for matching and syncing
        // GXN venue metadata
        timezone: info.timezone || '',
        tagline: info.tagline || '',
        directions: info.directions || '',
        menu: info.menu || '',
        socials: extractSocials(venueData.socials),
        operatingHours: simplifyOperatingHours(venueData.currentophours),
        seasons: venueData.seasons || null, // Store seasons as-is from GXN
        status: 'active',
        attributes: {
          dressCode: info.dresscode || ''
        },
        seats: seats,
        createdBy: userId,
        updatedBy: userId
      };
      
      // Create location
      const location = await Location.create(locationData);
      results.success.push({
        venueCode,
        locationId: location._id,
        name: info.name,
        seatsCreated: seats.length
      });
      
    } catch (error) {
      console.error(`Error importing venue ${venueCode}:`, error);
      results.failed.push({
        venueCode,
        error: error.message || 'Unknown error'
      });
    }
  }
  
  return results;
}

/**
 * Convert GXN time format to JavaScript Date object
 * @param {string} caldate - Date string in YYYY-MM-DD format
 * @param {string} timeSeconds - Time in seconds since midnight (e.g., "12200")
 * @param {string} timezone - Timezone string (e.g., "America/Los_Angeles")
 * @returns {Date} - JavaScript Date object
 */
function convertGXNTimeToDateTime(caldate, timeSeconds, timezone) {
  if (!caldate || !timeSeconds) return null;
  
  // Parse date
  const [year, month, day] = caldate.split('-').map(Number);
  if (!year || !month || !day) return null;
  
  // Convert seconds to hours, minutes
  const totalSeconds = parseInt(timeSeconds) || 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  
  // Create date in UTC (will be adjusted by timezone later)
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  
  // Note: MongoDB stores dates in UTC, timezone is stored separately
  return date;
}

/**
 * Extract event media from GXN flyers object
 * @param {Object} flyers - GXN flyers object
 * @returns {Array} - Array of media objects
 */
function extractEventMedia(flyers) {
  const media = [];
  let order = 0;
  
  if (!flyers || typeof flyers !== 'object') return media;
  
  // Iterate through flyer image types and extract images
  for (const [imageType, imageArray] of Object.entries(flyers)) {
    if (Array.isArray(imageArray) && imageArray.length > 0 && order < 5) {
      const img = imageArray[0];
      if (img.path && img.file) {
        media.push({
          type: 'image',
          url: `${img.path}/${img.file}`,
          caption: img.imagetypename || '',
          order: order++
        });
      }
    }
  }
  
  return media;
}

/**
 * Extract performers from GXN event performers object
 * @param {Object} performers - GXN performers object
 * @returns {Array} - Array of performer objects
 */
function extractPerformers(performers) {
  if (!performers || typeof performers !== 'object') return [];
  
  return Object.entries(performers).map(([perfcode, perfData]) => ({
    perfcode: perfcode || '',
    importance: perfData?.importance || '',
    apprtime: perfData?.apprtime || ''
  }));
}

/**
 * Calculate default end time based on event type
 * @param {Date} startDate - Event start date
 * @param {string} eventType - Event type (night_club, day_club, etc.)
 * @returns {Date} - Calculated end date
 */
function calculateDefaultEndTime(startDate, eventType) {
  const endDate = new Date(startDate);
  
  // Default durations based on event type
  const defaultDurations = {
    'night_club': 4, // 4 hours
    'day_club': 6, // 6 hours
    'restaurant': 3, // 3 hours
    'hotel': 24, // 24 hours (for overnight stays)
    'private': 4, // 4 hours
    'corporate': 4 // 4 hours
  };
  
  const hours = defaultDurations[eventType] || 4;
  endDate.setHours(endDate.getHours() + hours);
  
  return endDate;
}

/**
 * Import events from GXN schedules data into THE1 Event records
 * @param {Object} gxnData - Full GXN response data
 * @param {string} userId - Admin user ID performing import
 * @returns {Promise<Object>} Import results
 */
async function importEventsFromGXN(gxnData, userId) {
  const schedules = gxnData?.data?.schedules || {};
  const results = { success: [], failed: [], skipped: [] };
  
  for (const [dateKey, venuesByDate] of Object.entries(schedules)) {
    if (!venuesByDate || typeof venuesByDate !== 'object') continue;
    
    for (const [venueCode, ecozones] of Object.entries(venuesByDate)) {
      if (!ecozones || typeof ecozones !== 'object') continue;
      
      for (const [ecozoneCode, scheduleData] of Object.entries(ecozones)) {
        try {
          // Only import events where source is "Event" and has valid event data
          if (scheduleData.source !== 'Event' || !scheduleData.event) {
            results.skipped.push({
              venueCode,
              dateKey,
              ecozone: ecozoneCode,
              reason: scheduleData.source !== 'Event' ? 'Not an event (Hours of Operations)' : 'Missing event data'
            });
            continue;
          }
          
          const eventData = scheduleData.event;
          
          // Must have eventid and eventcode
          if (!eventData.eventid || !eventData.eventcode) {
            results.skipped.push({
              venueCode,
              dateKey,
              ecozone: ecozoneCode,
              reason: 'Missing eventid or eventcode'
            });
            continue;
          }
          
          // Check if event already exists
          const existingEvent = await Event.findOne({ gxnEventCode: eventData.eventcode });
          if (existingEvent) {
            results.skipped.push({
              venueCode,
              dateKey,
              ecozone: ecozoneCode,
              eventcode: eventData.eventcode,
              reason: 'Event already exists',
              eventId: existingEvent._id
            });
            continue;
          }
          
          // Find location by GXN venue code
          const location = await Location.findOne({ gxnVenueCode: venueCode });
          if (!location) {
            results.skipped.push({
              venueCode,
              dateKey,
              ecozone: ecozoneCode,
              reason: 'Location not found (venue must be imported first)'
            });
            continue;
          }
          
          // Convert times to Date objects
          const startDatetime = convertGXNTimeToDateTime(
            eventData.caldate,
            eventData.nstarttime || eventData.ndoorsopen,
            location.timezone || 'UTC'
          );
          
          if (!startDatetime) {
            results.skipped.push({
              venueCode,
              dateKey,
              ecozone: ecozoneCode,
              reason: 'Invalid start date/time'
            });
            continue;
          }
          
          let endDatetime;
          if (eventData.nendtime && eventData.nendtime !== '') {
            endDatetime = convertGXNTimeToDateTime(
              eventData.caldate,
              eventData.nendtime,
              location.timezone || 'UTC'
            );
          } else {
            // Calculate default end time based on event type
            endDatetime = calculateDefaultEndTime(startDatetime, location.type);
          }
          
          // Inherit seats from location (using existing service)
          const inheritanceResult = await inheritSeatsFromLocation(location._id, {
            name: eventData.name,
            type: location.type
          });
          
          // Extract media and performers
          const media = extractEventMedia(eventData.flyers);
          const performers = extractPerformers(eventData.performers);
          
          // Map status
          let eventStatus = 'active';
          if (scheduleData.status === 'Closed') {
            eventStatus = 'cancelled';
          }
          
          // Calculate base price from location seats (minimum seat price)
          const minSeatPrice = inheritanceResult.seats.length > 0
            ? Math.min(...inheritanceResult.seats.map(s => s.event_price || s.min_spend || 0))
            : 0;
          
          // Build event object
          const eventObj = {
            name: eventData.name || `Event at ${location.name}`,
            description: eventData.descr || '',
            type: location.type,
            location_id: location._id,
            start_datetime: startDatetime,
            end_datetime: endDatetime,
            timezone: location.timezone || 'UTC',
            total_capacity: inheritanceResult.totalCapacity || 0,
            total_available: inheritanceResult.totalCapacity || 0,
            total_booked: 0,
            total_revenue: 0,
            base_price: minSeatPrice,
            currency: 'USD',
            price_tier: 1,
            status: eventStatus,
            media: media,
            seats: inheritanceResult.seats,
            units: inheritanceResult.units,
            gxnEventCode: eventData.eventcode,
            gxnEventId: eventData.eventid.toString(),
            gxnEventDate: dateKey,
            performers: performers,
            created_by: userId,
            updated_by: userId
          };
          
          // Create event
          const event = await Event.create(eventObj);
          
          results.success.push({
            venueCode,
            dateKey,
            ecozone: ecozoneCode,
            eventcode: eventData.eventcode,
            eventId: event._id,
            name: eventData.name,
            seatsInherited: inheritanceResult.seats.length
          });
          
        } catch (error) {
          console.error(`Error importing event ${venueCode}/${ecozoneCode}:`, error);
          results.failed.push({
            venueCode,
            dateKey,
            ecozone: ecozoneCode,
            error: error.message || 'Unknown error'
          });
        }
      }
    }
  }
  
  return results;
}

module.exports = {
  importVenuesFromGXN,
  importEventsFromGXN
};

