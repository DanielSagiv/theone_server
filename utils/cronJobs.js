const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const subscriptionService = require('../services/subscriptionService');
const coeService = require('../services/coeService');

/**
 * Cron Jobs for Automated Subscription Billing
 * @description Handles recurring payment processing and subscription management
 */

/**
 * Process daily recurring payments
 * Runs every day at 00:00 UTC (midnight)
 */
function startRecurringPaymentsCron() {
  // Run daily at midnight UTC
  cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Running recurring payments cron job:', new Date().toISOString());
    
    try {
      // Find subscriptions due for billing today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const dueSubscriptions = await Subscription.find({
        status: 'active',
        next_billing_date: {
          $gte: today,
          $lt: tomorrow
        }
      });
      
      console.log(`📊 Found ${dueSubscriptions.length} subscriptions due for billing`);
      
      // Process each subscription
      let successCount = 0;
      let failureCount = 0;
      
      for (const subscription of dueSubscriptions) {
        try {
          await subscriptionService.processSubscriptionPayment(subscription._id);
          successCount++;
          console.log(`✅ Processed subscription: ${subscription._id}`);
        } catch (error) {
          failureCount++;
          console.error(`❌ Failed to process subscription ${subscription._id}:`, error.message);
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log('✅ Recurring payments cron job completed:', {
        total: dueSubscriptions.length,
        successful: successCount,
        failed: failureCount,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Recurring payments cron job failed:', error);
    }
  });
  
  console.log('✅ Recurring payments cron job scheduled (daily at 00:00 UTC)');
}

/**
 * Retry failed subscription payments
 * Runs every day at 12:00 UTC (noon)
 */
function startFailedPaymentRetryCron() {
  // Run daily at noon UTC
  cron.schedule('0 12 * * *', async () => {
    console.log('🔄 Running failed payment retry cron job:', new Date().toISOString());
    
    try {
      // Find subscriptions with recent failures (< 14 days ago)
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      
      const failedSubscriptions = await Subscription.find({
        status: 'active',
        failed_payments: { $gt: 0, $lt: 3 },
        last_failure_date: { $gte: fourteenDaysAgo }
      });
      
      console.log(`📊 Found ${failedSubscriptions.length} subscriptions to retry`);
      
      // Retry schedule: Day 3, Day 7, Day 14
      const retrySchedule = [3, 7, 14];
      let retryCount = 0;
      
      for (const subscription of failedSubscriptions) {
        const daysSinceFailure = Math.floor((Date.now() - subscription.last_failure_date) / (1000 * 60 * 60 * 24));
        
        if (retrySchedule.includes(daysSinceFailure)) {
          retryCount++;
          try {
            await subscriptionService.processSubscriptionPayment(subscription._id);
            console.log(`✅ Retry successful for subscription: ${subscription._id}`);
          } catch (error) {
            console.error(`❌ Retry failed for subscription ${subscription._id}:`, error.message);
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
        }
      }
      
      console.log('✅ Failed payment retry cron job completed:', {
        checked: failedSubscriptions.length,
        retried: retryCount,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Failed payment retry cron job failed:', error);
    }
  });
  
  console.log('✅ Failed payment retry cron job scheduled (daily at 12:00 UTC)');
}

/**
 * Expire cancelled subscriptions
 * Runs every day at 01:00 UTC
 */
function startSubscriptionExpirationCron() {
  // Run daily at 1 AM UTC
  cron.schedule('0 1 * * *', async () => {
    console.log('🔄 Running subscription expiration cron job:', new Date().toISOString());
    
    try {
      const now = new Date();
      
      // Find cancelled subscriptions past their end date
      const expiredSubscriptions = await Subscription.find({
        status: 'cancelled',
        end_date: { $lt: now }
      });
      
      console.log(`📊 Found ${expiredSubscriptions.length} subscriptions to expire`);
      
      for (const subscription of expiredSubscriptions) {
        subscription.status = 'expired';
        await subscription.save();
        
        // Update user membership
        const user = await User.findById(subscription.user_id);
        if (user && user.active_subscription_id?.toString() === subscription._id.toString()) {
          user.membership_status = 'expired';
          user.active_subscription_id = null;
          await user.save();
        }
        
        console.log(`✅ Subscription expired: ${subscription._id}`);
      }
      
      console.log('✅ Subscription expiration cron job completed:', {
        expired: expiredSubscriptions.length,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Subscription expiration cron job failed:', error);
    }
  });
  
  console.log('✅ Subscription expiration cron job scheduled (daily at 01:00 UTC)');
}

/**
 * Expire COEs that passed their payment deadline
 * Runs every 5 minutes
 */
function startCOEPaymentDeadlineCron() {
  // Every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    const startedAt = new Date();
    console.log('🔄 Running COE payment deadline cron job:', startedAt.toISOString());

    try {
      const expiredCount = await coeService.expireCOEsPastDeadline();
      console.log('✅ COE payment deadline cron job completed:', {
        expired: expiredCount,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ COE payment deadline cron job failed:', error);
    }
  });

  console.log('✅ COE payment deadline cron job scheduled (every 5 minutes)');
}

/**
 * Start all cron jobs
 */
function startAllCronJobs() {
  startRecurringPaymentsCron();
  startFailedPaymentRetryCron();
  startSubscriptionExpirationCron();
  startCOEPaymentDeadlineCron();
  console.log('🚀 All payment cron jobs started successfully');
}

module.exports = {
  startAllCronJobs,
  startRecurringPaymentsCron,
  startFailedPaymentRetryCron,
  startSubscriptionExpirationCron,
  startCOEPaymentDeadlineCron
};

