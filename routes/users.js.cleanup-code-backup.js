/**
 * BACKUP: Token Cleanup Code
 * 
 * This code was removed from routes/users.js to test if it was causing Android token registration issues.
 * 
 * To restore: Insert this code between line 749 (after deduplication) and line 750 (before await user.save())
 * 
 * Date removed: 2026-01-14
 * Reason: Testing if cleanup code was preventing Android token registration
 */

    // Clean up old Expo tokens when registering native token (FCM/APNs)
    // This ensures IPA/APK builds use native tokens, but keeps all native tokens for multiple devices
    if (!token.startsWith('ExponentPushToken[')) {
      // This is a native token (FCM for Android, APNs for iOS)
      const beforeCount = user.push_tokens.length;
      user.push_tokens = user.push_tokens.filter(t => {
        // Safety check: skip if token is missing
        if (!t || !t.token || typeof t.token !== 'string') {
          return false;
        }
        // Keep all native tokens (supports multiple devices: iPhone, iPad, Android, etc.)
        if (!t.token.startsWith('ExponentPushToken[')) {
          return true;
        }
        // Keep the new token being registered (even if it's Expo - shouldn't happen but safe)
        if (t.token === token) {
          return true;
        }
        // Remove old Expo tokens (they don't work in IPA/APK builds anyway)
        return false;
      });
      const removedCount = beforeCount - user.push_tokens.length;
      
      if (removedCount > 0) {
        console.log(`[UsersRoute] Cleaned up ${removedCount} old Expo token(s) when registering native token (${platform})`);
      }
    }

    // Age-based cleanup: Remove old unused Expo tokens (older than 7 days)
    // This is a background maintenance task that removes truly abandoned tokens
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const beforeAgeCleanup = user.push_tokens.length;
    
    user.push_tokens = user.push_tokens.filter(t => {
      // Safety check: skip if token is missing
      if (!t || !t.token || typeof t.token !== 'string') {
        return false;
      }
      // Keep all native tokens (they're always valid)
      if (!t.token.startsWith('ExponentPushToken[')) {
        return true;
      }
      
      // Keep Expo tokens that were used recently (within 7 days)
      if (t.last_used_at && new Date(t.last_used_at) > sevenDaysAgo) {
        return true;
      }
      
      // Keep Expo tokens that were registered recently (within 7 days)
      if (t.registered_at && new Date(t.registered_at) > sevenDaysAgo) {
        return true;
      }
      
      // Remove old unused Expo tokens (older than 7 days)
      return false;
    });
    
    const ageCleanupRemoved = beforeAgeCleanup - user.push_tokens.length;
    if (ageCleanupRemoved > 0) {
      console.log(`[UsersRoute] Cleaned up ${ageCleanupRemoved} old unused Expo token(s) (older than 7 days)`);
    }
