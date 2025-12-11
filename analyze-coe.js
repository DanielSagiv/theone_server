/**
 * Analyze COE directly from database
 */

const mongoose = require('mongoose');
const COE = require('./models/COE');

const mongoUri = 'mongodb+srv://sagiv:madonna@cluster0.et5fx.mongodb.net/kairo?retryWrites=true&w=majority';

async function analyzeCOE() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB\n');
    
    // Get the most recent COE for the test user
    const userId = '68dd73127f9a8aea777d2f34';
    const coe = await COE.findOne({ client_id: userId })
      .sort({ created_at: -1 })
      .populate('client_id', 'email firstName lastName')
      .populate('selected_seats.event_id', 'name start_datetime');
    
    if (!coe) {
      console.log('No COE found for user');
      return;
    }
    
    console.log('=== COE Analysis ===');
    console.log('COE ID:', coe._id);
    console.log('Name:', coe.name);
    console.log('Status:', coe.status);
    console.log('Created:', coe.created_at);
    console.log('\n=== Pricing ===');
    console.log('Subtotal:', coe.subtotal);
    console.log('Taxes:', coe.taxes);
    console.log('Fees:', coe.fees);
    console.log('Total:', coe.total);
    
    console.log('\n=== Selected Seats ===');
    console.log('Count:', coe.selected_seats?.length || 0);
    let totalSeatPrice = 0;
    coe.selected_seats?.forEach((seat, idx) => {
      const price = seat.event_price || seat.base_price || 0;
      totalSeatPrice += price;
      console.log(`\nSeat ${idx + 1}:`);
      console.log('  Code:', seat.seat_code);
      console.log('  Event:', seat.event_id?.name || seat.event_id);
      console.log('  Price:', price);
      console.log('  Capacity:', seat.capacity);
    });
    console.log('\nTotal Seat Prices:', totalSeatPrice);
    console.log('Expected Subtotal:', totalSeatPrice);
    
    console.log('\n=== Upgrade Offers ===');
    console.log('Count:', coe.seat_upgrade_offers?.length || 0);
    if (coe.seat_upgrade_offers && coe.seat_upgrade_offers.length > 0) {
      coe.seat_upgrade_offers.forEach((offer, idx) => {
        console.log(`\nOffer ${idx + 1}:`);
        console.log('  Event:', offer.event_name);
        console.log('  Current Seat:', offer.current_seat_code, `$${offer.current_price}`);
        console.log('  Alternatives:', offer.alternatives?.length || 0);
        if (offer.alternatives) {
          offer.alternatives.forEach((alt, altIdx) => {
            console.log(`    ${altIdx + 1}. ${alt.seat_code} - $${alt.event_price}`);
            console.log(`       Price Delta: +$${alt.price_delta}`);
            console.log(`       Tag: ${alt.tag}`);
            console.log(`       Fits Budget: ${alt.fits_budget}`);
          });
        }
      });
    } else {
      console.log('No upgrade offers found');
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

analyzeCOE();





