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

    if (status !== 'pendingApproval') {
      return next();
    }

    const pathOnly = (req.originalUrl || '').split('?')[0];
    const method = String(req.method || 'GET').toUpperCase();
    const allowedPendingRoutes = new Set([
      'GET:/v1/auth/validate',
      'POST:/v1/auth/logout',
      'GET:/v1/users/profile',
      'GET:/v1/features',
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
