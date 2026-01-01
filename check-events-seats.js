/**
 * Check events and seats in database to understand upgrade availability
 */

const mongoose = require('mongoose');
const Event = require('./models/Event');
const Location = require('./models/Location');

const mongoUri = 'mongodb+srv://sagiv:madonna@cluster0.et5fx.mongodb.net/kairo?retryWrites=true&w=majority';

async function checkEventsAndSeats() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB\n');
    
    // Find events in Las Vegas between Nov 28 - Dec 2, 2025
    const startDate = new Date('2025-11-28T00:00:00.000Z');
    const endDate = new Date('2025-12-02T23:59:59.999Z');
    
    console.log('=== Searching for Events ===');
    console.log('Date Range:', startDate.toISOString(), 'to', endDate.toISOString());
    console.log('City: Las Vegas\n');
    
    const events = await Event.find({
      status: 'active',
      start_datetime: { $gte: startDate, $lte: endDate },
      end_datetime: { $gte: new Date() }
    })
    .populate('location_id', 'name address.city seats')
    .limit(10);
    
    console.log(`Found ${events.length} events\n`);
    
    if (events.length === 0) {
      console.log('No events found in date range');
      await mongoose.disconnect();
      return;
    }
    
    // Check each event
    for (const event of events) {
      console.log('='.repeat(60));
      console.log(`Event: ${event.name}`);
      console.log(`Event ID: ${event._id}`);
      console.log(`Date: ${event.start_datetime?.toISOString()}`);
      console.log(`Location: ${event.location_id?.name || 'N/A'}`);
      console.log(`City: ${event.location_id?.address?.city || 'N/A'}`);
      console.log(`Total Seats: ${event.seats?.length || 0}`);
      
      if (!event.location_id || !event.location_id.seats) {
        console.log('⚠️  Location or location seats not populated');
        console.log('');
        continue;
      }
      
      // Get available seats
      const availableSeats = event.seats.filter(s => s.status === 'available');
      console.log(`Available Seats: ${availableSeats.length}`);
      
      if (availableSeats.length === 0) {
        console.log('⚠️  No available seats in this event');
        console.log('');
        continue;
      }
      
      // Check seats with capacity >= 5
      const seatsFor5 = availableSeats.filter(s => (s.capacity || 0) >= 5);
      console.log(`Seats with capacity >= 5: ${seatsFor5.length}`);
      
      if (seatsFor5.length === 0) {
        console.log('⚠️  No seats with capacity >= 5');
        console.log('');
        continue;
      }
      
      // Match event seats with location seats and get quality scores
      console.log('\n--- Seat Details (capacity >= 5) ---');
      const seatDetails = seatsFor5.map(eventSeat => {
        // Find location seat by code or seat_id
        const locationSeat = event.location_id.seats.find(locSeat => {
          if (locSeat.code === eventSeat.code) return true;
          const eventSeatId = eventSeat.seat_id?.toString();
          const locSeatId = locSeat._id?.toString();
          return eventSeatId && locSeatId && locSeatId === eventSeatId;
        });
        
        const qualityScore = locationSeat?.qualityScore || eventSeat.qualityScore || 5;
        const sentiment = locationSeat?.sentiment || [];
        const hasTypeA = sentiment.some(s => s.type === 'A');
        const hasTypeB = sentiment.some(s => s.type === 'B');
        const sentimentText = sentiment.map(s => s.text || '').join(' ').toLowerCase();
        
        // Calculate score (same as scoreSeatQuality)
        let score = qualityScore * 10;
        if (hasTypeA) score += 5;
        if (hasTypeB) score += 2;
        if (sentimentText.includes('vip')) score += 2;
        if (sentimentText.includes('premium')) score += 2;
        if (sentimentText.includes('upper')) score += 2;
        if (sentimentText.includes('front')) score += 1;
        if (sentimentText.includes('center')) score += 1;
        
        return {
          code: eventSeat.code,
          capacity: eventSeat.capacity,
          price: eventSeat.event_price || eventSeat.min_spend || 0,
          qualityScore: qualityScore,
          score: score,
          sentiment: sentiment.map(s => `${s.type}: ${s.text}`).join(', ') || 'None',
          locationSeatFound: !!locationSeat
        };
      });
      
      // Sort by score
      seatDetails.sort((a, b) => b.score - a.score);
      
      seatDetails.forEach((seat, idx) => {
        console.log(`\n${idx + 1}. ${seat.code}`);
        console.log(`   Capacity: ${seat.capacity}`);
        console.log(`   Price: $${seat.price}`);
        console.log(`   Quality Score: ${seat.qualityScore}/10`);
        console.log(`   Total Score: ${seat.score}`);
        console.log(`   Sentiment: ${seat.sentiment || 'None'}`);
        console.log(`   Location Seat Found: ${seat.locationSeatFound}`);
      });
      
      // Check if there are score differences
      if (seatDetails.length > 1) {
        const highestScore = seatDetails[0].score;
        const lowestScore = seatDetails[seatDetails.length - 1].score;
        const scoreDiff = highestScore - lowestScore;
        
        console.log(`\n--- Score Analysis ---`);
        console.log(`Highest Score: ${highestScore} (${seatDetails[0].code})`);
        console.log(`Lowest Score: ${lowestScore} (${seatDetails[seatDetails.length - 1].code})`);
        console.log(`Score Difference: ${scoreDiff}`);
        
        if (scoreDiff === 0) {
          console.log('⚠️  ALL SEATS HAVE THE SAME SCORE - No upgrades possible!');
        } else {
          console.log(`✅ Score differences found - Upgrades should be possible`);
          console.log(`   Seats that could be upgraded:`);
          seatDetails.slice(1).forEach(seat => {
            if (seat.score < highestScore) {
              console.log(`   - ${seat.code} (score: ${seat.score}) could upgrade to ${seatDetails[0].code} (score: ${highestScore})`);
            }
          });
        }
      } else {
        console.log('\n⚠️  Only one seat available - No upgrade options');
      }
      
      console.log('');
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkEventsAndSeats();















