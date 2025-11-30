/**
 * Analyze locations and events to propose quality scores and test prompt
 */

const mongoose = require('mongoose');
const Event = require('./models/Event');
const Location = require('./models/Location');

const mongoUri = process.env.DB_URI || 'mongodb+srv://sagiv:madonna@cluster0.et5fx.mongodb.net/kairo?retryWrites=true&w=majority';

async function analyzeLocationsAndEvents() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB\n');
    
    // Find all locations
    const locations = await Location.find({})
      .select('name type address.city seats')
      .limit(20);
    
    console.log('='.repeat(80));
    console.log('LOCATIONS ANALYSIS');
    console.log('='.repeat(80));
    console.log(`Found ${locations.length} locations\n`);
    
    // Find Las Vegas locations specifically
    const vegasLocations = locations.filter(loc => 
      loc.address?.city?.toLowerCase().includes('vegas') || 
      loc.address?.city?.toLowerCase().includes('las vegas')
    );
    
    if (vegasLocations.length > 0) {
      console.log(`\n📍 LAS VEGAS LOCATIONS: ${vegasLocations.length}\n`);
      
      for (const location of vegasLocations) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`Location: ${location.name}`);
        console.log(`Type: ${location.type}`);
        console.log(`City: ${location.address?.city || 'N/A'}`);
        console.log(`Total Seats: ${location.seats?.length || 0}`);
        
        if (location.seats && location.seats.length > 0) {
          console.log('\n📊 SEAT ANALYSIS:');
          console.log('─'.repeat(80));
          
          // Group seats by category
          const seatsByCategory = {};
          location.seats.forEach(seat => {
            const category = seat.category || 'uncategorized';
            if (!seatsByCategory[category]) {
              seatsByCategory[category] = [];
            }
            seatsByCategory[category].push(seat);
          });
          
          // Display seats with current quality scores
          console.log('\nCurrent Seat Configuration:');
          console.log('─'.repeat(80));
          console.log('Code'.padEnd(25) + 'Category'.padEnd(20) + 'Capacity'.padEnd(10) + 'Quality'.padEnd(10) + 'Price Tier');
          console.log('─'.repeat(80));
          
          location.seats.forEach(seat => {
            const code = (seat.code || 'N/A').padEnd(25);
            const category = (seat.category || 'N/A').padEnd(20);
            const capacity = String(seat.capacity || 0).padEnd(10);
            const quality = String(seat.qualityScore || 5).padEnd(10);
            const priceTier = String(seat.priceTier || 1);
            console.log(`${code}${category}${capacity}${quality}${priceTier}`);
          });
        }
      }
    }
    
    // Find events in date range Nov 28 - Dec 2, 2025
    const startDate = new Date('2025-11-28T00:00:00.000Z');
    const endDate = new Date('2025-12-02T23:59:59.999Z');
    
    console.log('\n\n' + '='.repeat(80));
    console.log('EVENTS ANALYSIS');
    console.log('='.repeat(80));
    console.log(`Date Range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n`);
    
    const events = await Event.find({
      status: 'active',
      start_datetime: { $gte: startDate, $lte: endDate }
    })
    .populate('location_id', 'name address.city seats')
    .limit(20);
    
    console.log(`Found ${events.length} active events in date range\n`);
    
    if (events.length > 0) {
      // Group by location
      const eventsByLocation = {};
      events.forEach(event => {
        const locId = event.location_id?._id?.toString() || 'unknown';
        if (!eventsByLocation[locId]) {
          eventsByLocation[locId] = {
            location: event.location_id,
            events: []
          };
        }
        eventsByLocation[locId].events.push(event);
      });
      
      for (const [locId, data] of Object.entries(eventsByLocation)) {
        const location = data.location;
        if (!location) continue;
        
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`📍 Location: ${location.name}`);
        console.log(`   City: ${location.address?.city || 'N/A'}`);
        console.log(`   Events: ${data.events.length}`);
        
        for (const event of data.events) {
          console.log(`\n   🎉 Event: ${event.name}`);
          console.log(`      Date: ${event.start_datetime?.toISOString().split('T')[0] || 'N/A'}`);
          console.log(`      Available Seats: ${event.seats?.filter(s => s.status === 'available').length || 0}`);
          console.log(`      Total Seats: ${event.seats?.length || 0}`);
          
          // Show available seats with capacity >= 5
          const availableFor5 = event.seats?.filter(s => 
            s.status === 'available' && (s.capacity || 0) >= 5
          ) || [];
          
          if (availableFor5.length > 0) {
            console.log(`      Seats for 5+ people: ${availableFor5.length}`);
            console.log(`      Seat codes: ${availableFor5.map(s => s.code).join(', ')}`);
          }
        }
      }
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    if (error.message.includes('authentication failed')) {
      console.error('\n⚠️  MongoDB authentication failed. Please check your connection string.');
    }
    process.exit(1);
  }
}

analyzeLocationsAndEvents();

