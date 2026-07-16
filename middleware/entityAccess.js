/**
 * Entity access guard for authenticated app users.
 * Blocks pending/declined client accounts from app APIs while allowing minimal self-service endpoints.
 */
function requireClientApprovedForApi(req, res, next) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
        },
      });
    }

    if (user.role === 'admin') {
      return next();
    }

    if (user.role !== 'client') {
      return next();
    }

    const status = user.entity_status;
    if (status === 'registrationDeclined') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'REGISTRATION_DECLINED',
          message: 'Your account registration was declined. Please contact an administrator.',
        },
      });
    }

    const pathOnly = (req.originalUrl || '').split('?')[0];
    const method = String(req.method || 'GET').toUpperCase();
    if (status !== 'pendingApproval') {
      const subscriptionExpired =
        !user.subscription_expires_at || new Date(user.subscription_expires_at) <= new Date();
      const requiresSubscriptionNow =
        status === 'live' &&
        user.subscription_required === true &&
        subscriptionExpired;
      if (!requiresSubscriptionNow) {
        return next();
      }

      const allowedSubscriptionRoutes = new Set([
        'GET:/v1/auth/validate',
        'POST:/v1/auth/logout',
        'GET:/v1/users/profile',
        'GET:/v1/features',
        'GET:/v1/notifications',
        'GET:/v1/notifications/unread-count',
        'GET:/v1/payments/saved-cards',
        'POST:/v1/payments/tokenize',
        'PUT:/v1/payments/saved-cards/:tokenId',
        'PUT:/v1/payments/saved-cards/:tokenId/default',
        'DELETE:/v1/payments/saved-cards/:tokenId',
        'POST:/v1/subscriptions/pay-required-annual',
        'GET:/v1/subscriptions/required-status',
      ]);

      const signature = `${method}:${pathOnly}`;
      const matchesTokenPath =
        /^PUT:\/v1\/payments\/saved-cards\/[^/]+$/.test(signature) ||
        /^PUT:\/v1\/payments\/saved-cards\/[^/]+\/default$/.test(signature) ||
        /^DELETE:\/v1\/payments\/saved-cards\/[^/]+$/.test(signature);
      if (allowedSubscriptionRoutes.has(signature) || matchesTokenPath) {
        return next();
      }

      return res.status(403).json({
        success: false,
        error: {
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'Annual subscription payment is required before app access.',
        },
      });
    }

    const allowedPendingRoutes = new Set([
      'GET:/v1/auth/validate',
      'POST:/v1/auth/logout',
      'POST:/v1/auth/accept-legal',
      'GET:/v1/users/profile',
      'GET:/v1/features',
      'GET:/v1/notifications',
      'GET:/v1/notifications/unread-count',
    ]);

    if (allowedPendingRoutes.has(`${method}:${pathOnly}`)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: {
        code: 'PENDING_THE1_APPROVAL',
        message: 'Your account is pending The1 approval.',
      },
    });
  } catch (error) {
    console.error('Entity access guard error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_INTERNAL_ERROR',
        message: 'Authorization failed',
      },
    });
  }
}

module.exports = {
  requireClientApprovedForApi,
};
