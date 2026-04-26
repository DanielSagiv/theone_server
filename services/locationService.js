const Location = require('../models/Location');

/**
 * Location Service
 * @description General location utility functions
 */

/**
 * Get all unique cities that have locations
 * @param {Object} options - Query options
 * @param {string} options.status - Filter by location status ('active', 'draft', 'archived', or null for all)
 * @param {boolean} options.includeEmpty - Include cities with empty/null values (default: false)
 * @returns {Promise<Array<string>>} Sorted array of unique city names
 */
async function getAllCitiesWithLocations(options = {}) {
  try {
    const { status = 'active', includeEmpty = false } = options;
    
    // Build filter
    const filter = {};
    if (status) {
      filter.status = status;
    }
    if (!includeEmpty) {
      filter['address.city'] = { $exists: true, $ne: null, $ne: '' };
    }
    
    console.log('getAllCitiesWithLocations - Query filter:', JSON.stringify(filter, null, 2));
    
    // Query distinct cities using MongoDB distinct for efficiency
    const cities = await Location.distinct('address.city', filter);
    console.log('getAllCitiesWithLocations - Raw cities from DB:', cities);
    
    // Process results: trim, filter empty, remove duplicates (case-insensitive), sort
    const processedCities = cities
      .map(city => city?.trim())
      .filter(city => city && city.length > 0)
      .filter((city, index, self) => {
        // Case-insensitive duplicate check
        const lowerCity = city.toLowerCase();
        return self.findIndex(c => c.toLowerCase() === lowerCity) === index;
      })
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })); // Case-insensitive sort
    
    console.log('getAllCitiesWithLocations result:', { 
      status, 
      includeEmpty, 
      citiesFound: processedCities.length 
    });
    
    return processedCities;
  } catch (error) {
    console.error('Error in getAllCitiesWithLocations:', error);
    return [];
  }
}

/**
 * Get all unique (city, state) pairs that have locations
 * @param {Object} options - Query options
 * @param {string} options.status - Filter by location status ('active', 'draft', 'archived', or null for all)
 * @returns {Promise<Array<{city: string, state: string|null, display: string}>>}
 */
async function getAllCityStatePairsWithLocations(options = {}) {
  try {
    const { status = 'active' } = options;

    const match = {};
    if (status) {
      match.status = status;
    }
    match['address.city'] = { $exists: true, $ne: null, $ne: '' };

    const results = await Location.aggregate([
      { $match: match },
      {
        $project: {
          city: { $trim: { input: '$address.city' } },
          state: {
            $cond: [
              { $and: [{ $ne: ['$address.state', null] }, { $ne: ['$address.state', ''] }] },
              { $trim: { input: '$address.state' } },
              null
            ]
          }
        }
      },
      {
        $group: {
          _id: { city: '$city', state: '$state' }
        }
      },
      {
        $project: {
          _id: 0,
          city: '$_id.city',
          state: '$_id.state'
        }
      }
    ]);

    const normalized = (results || [])
      .filter(r => r.city && typeof r.city === 'string' && r.city.trim().length > 0)
      .map(r => {
        const city = r.city.trim();
        const state = typeof r.state === 'string' && r.state.trim().length > 0 ? r.state.trim() : null;
        return {
          city,
          state,
          display: state ? `${city}, ${state}` : city
        };
      })
      .sort((a, b) => a.display.localeCompare(b.display, undefined, { sensitivity: 'base' }));

    return normalized;
  } catch (error) {
    console.error('Error in getAllCityStatePairsWithLocations:', error);
    return [];
  }
}

module.exports = {
  getAllCitiesWithLocations,
  getAllCityStatePairsWithLocations
};

