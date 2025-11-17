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

module.exports = {
  getAllCitiesWithLocations
};

