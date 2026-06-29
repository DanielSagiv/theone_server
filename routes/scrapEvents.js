const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { fetchLivLasVegasEventsPreview } = require('../services/scrapEvents/livLasVegasScraperService');
const {
  prepareLivEventImport,
  undoLivEventImport,
  partitionLivEventsByImportStatus,
  validateLivDateRangeQuery,
  filterLivEventsByDateRange,
  filterLivEventsNotInPast,
} = require('../services/scrapEvents/livLasVegasEventImportService');
const { normalizeLivScope } = require('../utils/livVenueConfig');
const { fetchOmniaEventsPreview } = require('../services/scrapEvents/omniaScraperService');
const {
  prepareOmniaEventImport,
  undoOmniaEventImport,
  resyncOmniaEventPricing,
  partitionOmniaEventsByImportStatus,
  validateOmniaDateRangeQuery,
  filterOmniaEventsByDateRange,
  filterOmniaEventsNotInPast,
} = require('../services/scrapEvents/omniaEventImportService');
const { normalizeOmniaScope } = require('../utils/omniaVenueConfig');
const { fetchHakkasanEventsPreview } = require('../services/scrapEvents/hakkasanScraperService');
const {
  prepareHakkasanEventImport,
  undoHakkasanEventImport,
  resyncHakkasanEventPricing,
  partitionHakkasanEventsByImportStatus,
  validateHakkasanDateRangeQuery,
  filterHakkasanEventsByDateRange,
  filterHakkasanEventsNotInPast,
} = require('../services/scrapEvents/hakkasanEventImportService');
const { fetchTaoBeachEventsPreview } = require('../services/scrapEvents/taoBeachScraperService');
const {
  prepareTaoBeachEventImport,
  undoTaoBeachEventImport,
  resyncTaoBeachEventPricing,
  partitionTaoBeachEventsByImportStatus,
  validateTaoBeachDateRangeQuery,
  filterTaoBeachEventsByDateRange,
  filterTaoBeachEventsNotInPast,
} = require('../services/scrapEvents/taoBeachEventImportService');
const { fetchPalmTreeBeachEventsPreview } = require('../services/scrapEvents/palmTreeBeachScraperService');
const {
  preparePalmTreeBeachImport,
  undoPalmTreeBeachImport,
  resyncPalmTreeBeachEventPricing,
  partitionPalmTreeBeachEventsByImportStatus,
  validatePalmTreeBeachDateRangeQuery,
  filterPalmTreeBeachEventsByDateRange,
  filterPalmTreeBeachEventsNotInPast,
} = require('../services/scrapEvents/palmTreeBeachEventImportService');
const { fetchMarqueeDayclubEventsPreview } = require('../services/scrapEvents/marqueeDayclubScraperService');
const {
  prepareMarqueeDayclubImport,
  undoMarqueeDayclubImport,
  resyncMarqueeDayclubEventPricing,
  partitionMarqueeDayclubEventsByImportStatus,
  validateMarqueeDayclubDateRangeQuery,
  filterMarqueeDayclubEventsByDateRange,
  filterMarqueeDayclubEventsNotInPast,
} = require('../services/scrapEvents/marqueeDayclubEventImportService');
const { fetchMarqueeNightclubEventsPreview } = require('../services/scrapEvents/marqueeNightclubScraperService');
const {
  prepareMarqueeNightclubImport,
  undoMarqueeNightclubImport,
  resyncMarqueeNightclubEventPricing,
  partitionMarqueeNightclubEventsByImportStatus,
  validateMarqueeNightclubDateRangeQuery,
  filterMarqueeNightclubEventsByDateRange,
  filterMarqueeNightclubEventsNotInPast,
} = require('../services/scrapEvents/marqueeNightclubEventImportService');

const router = express.Router();

/**
 * GET /v1/scrap-events/liv/events
 * @description Preview LIV Las Vegas events from venue listing (no database writes).
 * Query: diffOnly (default true), scope (default nightlife), fromDate, toDate (optional pair).
 */
router.get('/liv/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const diffOnly = req.query.diffOnly !== 'false';
    const scope = normalizeLivScope(req.query.scope);
    const dateRange = validateLivDateRangeQuery(req.query.fromDate, req.query.toDate);

    console.log('[scrap-events] GET /liv/events: start', {
      userId: req.user?._id,
      diffOnly,
      scope,
      dateFilter: dateRange.active ? { from: dateRange.fromDate, to: dateRange.toDate } : null,
    });
    const payload = await fetchLivLasVegasEventsPreview();

    if (payload.browserError) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SCRAP_BROWSER_UNAVAILABLE',
          message: 'Could not load LIV events page in headless browser',
          details: payload.browserError,
        },
        sourceUrl: payload.sourceUrl,
        warnings: payload.warnings,
      });
    }

    const allEvents = payload.events || [];
    const totalScraped = allEvents.length;
    const upcomingEvents = filterLivEventsNotInPast(allEvents);
    const pastExcludedCount = totalScraped - upcomingEvents.length;

    const partitionAll = await partitionLivEventsByImportStatus(upcomingEvents, { scope });
    const allNewEvents = partitionAll.newEvents;
    const allImportedEvents = partitionAll.alreadyImported;

    const eventsForPartition = dateRange.active
      ? filterLivEventsByDateRange(upcomingEvents, dateRange.fromDate, dateRange.toDate)
      : upcomingEvents;
    const inDateRangeTotal = eventsForPartition.length;

    const partition = await partitionLivEventsByImportStatus(eventsForPartition, { scope });

    let events;
    if (diffOnly) {
      events = partition.newEvents;
    } else {
      events = [...partition.newEvents, ...partition.alreadyImported];
    }

    const stats = {
      ...partition.stats,
      totalScraped,
      pastExcludedCount,
      upcomingTotal: upcomingEvents.length,
      inDateRangeTotal: dateRange.active ? inDateRangeTotal : upcomingEvents.length,
    };

    res.json({
      success: true,
      sourceUrl: payload.sourceUrl,
      scrapedAt: payload.scrapedAt,
      count: events.length,
      events,
      alreadyImported: partition.alreadyImported,
      allNewEvents,
      allImportedEvents,
      stats,
      dateFilter: {
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
        active: dateRange.active,
      },
      diffOnly,
      scope,
      warnings: payload.warnings,
    });
  } catch (error) {
    if (error.code === 'LIV_INVALID_DATE_RANGE') {
      return res.status(400).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }
    console.error('[scrap-events] GET /liv/events error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'LIV_SCRAPE_FAILED',
        message: 'Failed to fetch LIV live events',
        details: error.message,
      },
    });
  }
});

/**
 * POST /v1/scrap-events/liv/prepare-import
 * @description Scrape LIV event detail and return create-event prefill (no DB writes).
 */
router.post('/liv/prepare-import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[scrap-events] POST /liv/prepare-import: start', {
      userId: req.user?._id,
      eventCode: req.body?.eventCode,
    });

    const result = await prepareLivEventImport(req.body || {});

    if (result.alreadyImported) {
      return res.json({
        success: true,
        alreadyImported: true,
        eventId: result.eventId,
        eventName: result.eventName,
        livEventCode: result.livEventCode,
        message: `Event already imported: ${result.eventName}`,
      });
    }

    res.json({
      success: true,
      alreadyImported: false,
      prefill: result.prefill,
      warnings: result.warnings || [],
      livEventCode: result.livEventCode,
    });
  } catch (error) {
    const code = error.code || 'LIV_PREPARE_IMPORT_FAILED';
    console.error('[scrap-events] POST /liv/prepare-import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(error.code ? 400 : 500).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to prepare LIV event import',
      },
    });
  }
});

/**
 * DELETE /v1/scrap-events/liv/import/:livEventCode
 * @description Undo a LIV import (delete THE1 event) when not used in COEs or booked.
 */
router.delete('/liv/import/:livEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { livEventCode } = req.params;
    console.log('[scrap-events] DELETE /liv/import: start', {
      userId: req.user?._id,
      livEventCode,
    });

    const result = await undoLivEventImport(livEventCode);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const code = error.code || 'LIV_UNDO_IMPORT_FAILED';
    const status =
      code === 'LIV_EVENT_NOT_FOUND'
        ? 404
        : code === 'LIV_EVENT_IN_COE_USE' || code === 'EVENT_HAS_BOOKINGS'
          ? 409
          : error.code
            ? 400
            : 500;
    console.error('[scrap-events] DELETE /liv/import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to undo LIV import',
      },
    });
  }
});

/**
 * GET /v1/scrap-events/omnia/events
 * @description Preview OMNIA Night Club events from Booketing calendar (no database writes).
 * Query: diffOnly (default true), scope (default nightlife), fromDate, toDate (optional pair).
 */
router.get('/omnia/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const diffOnly = req.query.diffOnly !== 'false';
    const scope = normalizeOmniaScope(req.query.scope);
    const dateRange = validateOmniaDateRangeQuery(req.query.fromDate, req.query.toDate);

    console.log('[scrap-events] GET /omnia/events: start', {
      userId: req.user?._id,
      diffOnly,
      scope,
      dateFilter: dateRange.active ? { from: dateRange.fromDate, to: dateRange.toDate } : null,
    });
    const payload = await fetchOmniaEventsPreview({ scope });

    if (payload.browserError) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SCRAP_BROWSER_UNAVAILABLE',
          message: 'Could not load OMNIA events page in headless browser',
          details: payload.browserError,
        },
        sourceUrl: payload.sourceUrl,
        warnings: payload.warnings,
      });
    }

    const allEvents = payload.events || [];
    const totalScraped = allEvents.length;
    const upcomingEvents = filterOmniaEventsNotInPast(allEvents);
    const pastExcludedCount = totalScraped - upcomingEvents.length;

    const partitionAll = await partitionOmniaEventsByImportStatus(upcomingEvents, { scope });
    const allNewEvents = partitionAll.newEvents;
    const allImportedEvents = partitionAll.alreadyImported;

    const eventsForPartition = dateRange.active
      ? filterOmniaEventsByDateRange(upcomingEvents, dateRange.fromDate, dateRange.toDate)
      : upcomingEvents;
    const inDateRangeTotal = eventsForPartition.length;

    const partition = await partitionOmniaEventsByImportStatus(eventsForPartition, { scope });

    let events;
    if (diffOnly) {
      events = partition.newEvents;
    } else {
      events = [...partition.newEvents, ...partition.alreadyImported];
    }

    const stats = {
      ...partition.stats,
      totalScraped,
      pastExcludedCount,
      upcomingTotal: upcomingEvents.length,
      monthScope: payload.monthScope || null,
      inDateRangeTotal: dateRange.active ? inDateRangeTotal : upcomingEvents.length,
    };

    res.json({
      success: true,
      sourceUrl: payload.sourceUrl,
      scrapedAt: payload.scrapedAt,
      count: events.length,
      events,
      alreadyImported: partition.alreadyImported,
      allNewEvents,
      allImportedEvents,
      stats,
      dateFilter: {
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
        active: dateRange.active,
      },
      diffOnly,
      scope,
      warnings: payload.warnings,
    });
  } catch (error) {
    if (error.code === 'OMNIA_INVALID_DATE_RANGE') {
      return res.status(400).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }
    console.error('[scrap-events] GET /omnia/events error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'OMNIA_SCRAPE_FAILED',
        message: 'Failed to fetch OMNIA live events',
        details: error.message,
      },
    });
  }
});

/**
 * POST /v1/scrap-events/omnia/prepare-import
 * @description Scrape OMNIA event detail and return create-event prefill (no DB writes).
 */
router.post('/omnia/prepare-import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[scrap-events] POST /omnia/prepare-import: start', {
      userId: req.user?._id,
      eventCode: req.body?.eventCode,
    });

    const result = await prepareOmniaEventImport(req.body || {});

    if (result.alreadyImported) {
      return res.json({
        success: true,
        alreadyImported: true,
        eventId: result.eventId,
        eventName: result.eventName,
        omniaEventCode: result.omniaEventCode,
        message: `Event already imported: ${result.eventName}`,
      });
    }

    res.json({
      success: true,
      alreadyImported: false,
      prefill: result.prefill,
      warnings: result.warnings || [],
      omniaEventCode: result.omniaEventCode,
    });
  } catch (error) {
    const code = error.code || 'OMNIA_PREPARE_IMPORT_FAILED';
    console.error('[scrap-events] POST /omnia/prepare-import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(error.code ? 400 : 500).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to prepare OMNIA event import',
      },
    });
  }
});

/**
 * DELETE /v1/scrap-events/omnia/import/:omniaEventCode
 * @description Undo an OMNIA import (delete THE1 event) when not used in COEs or booked.
 */
router.delete('/omnia/import/:omniaEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { omniaEventCode } = req.params;
    console.log('[scrap-events] DELETE /omnia/import: start', {
      userId: req.user?._id,
      omniaEventCode,
    });

    const result = await undoOmniaEventImport(omniaEventCode);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const code = error.code || 'OMNIA_UNDO_IMPORT_FAILED';
    const status =
      code === 'OMNIA_EVENT_NOT_FOUND'
        ? 404
        : code === 'OMNIA_EVENT_IN_COE_USE' || code === 'EVENT_HAS_BOOKINGS'
          ? 409
          : error.code
            ? 400
            : 500;
    console.error('[scrap-events] DELETE /omnia/import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to undo OMNIA import',
      },
    });
  }
});

/**
 * POST /v1/scrap-events/omnia/resync-pricing/:omniaEventCode
 * @description Re-scrape Booketing TABLES min spend onto an existing OMNIA-imported event.
 */
router.post('/omnia/resync-pricing/:omniaEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { omniaEventCode } = req.params;
    console.log('[scrap-events] POST /omnia/resync-pricing: start', {
      userId: req.user?._id,
      omniaEventCode,
    });

    const result = await resyncOmniaEventPricing(omniaEventCode);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const code = error.code || 'OMNIA_RESYNC_PRICING_FAILED';
    const status =
      code === 'OMNIA_EVENT_NOT_FOUND'
        ? 404
        : error.code
          ? 400
          : 500;
    console.error('[scrap-events] POST /omnia/resync-pricing error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to resync OMNIA event pricing',
      },
    });
  }
});

/**
 * GET /v1/scrap-events/hakkasan/events
 * @description Preview Hakkasan Las Vegas events from Booketing listing (no database writes).
 */
router.get('/hakkasan/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const diffOnly = req.query.diffOnly !== 'false';
    const dateRange = validateHakkasanDateRangeQuery(req.query.fromDate, req.query.toDate);

    console.log('[scrap-events] GET /hakkasan/events: start', {
      userId: req.user?._id,
      diffOnly,
      dateFilter: dateRange.active ? { from: dateRange.fromDate, to: dateRange.toDate } : null,
    });

    const payload = await fetchHakkasanEventsPreview();

    if (payload.browserError) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SCRAP_BROWSER_UNAVAILABLE',
          message: 'Could not load Hakkasan events page in headless browser',
          details: payload.browserError,
        },
        sourceUrl: payload.sourceUrl,
        warnings: payload.warnings,
      });
    }

    const allEvents = payload.events || [];
    const totalScraped = allEvents.length;
    const upcomingEvents = filterHakkasanEventsNotInPast(allEvents);
    const pastExcludedCount = totalScraped - upcomingEvents.length;

    const partitionAll = await partitionHakkasanEventsByImportStatus(upcomingEvents);
    const allNewEvents = partitionAll.newEvents;
    const allImportedEvents = partitionAll.alreadyImported;

    const eventsForPartition = dateRange.active
      ? filterHakkasanEventsByDateRange(upcomingEvents, dateRange.fromDate, dateRange.toDate)
      : upcomingEvents;
    const inDateRangeTotal = eventsForPartition.length;

    const partition = await partitionHakkasanEventsByImportStatus(eventsForPartition);

    let events;
    if (diffOnly) {
      events = partition.newEvents;
    } else {
      events = [...partition.newEvents, ...partition.alreadyImported];
    }

    const stats = {
      ...partition.stats,
      totalScraped,
      pastExcludedCount,
      upcomingTotal: upcomingEvents.length,
      monthScope: payload.monthScope || null,
      inDateRangeTotal: dateRange.active ? inDateRangeTotal : upcomingEvents.length,
    };

    res.json({
      success: true,
      sourceUrl: payload.sourceUrl,
      scrapedAt: payload.scrapedAt,
      count: events.length,
      events,
      alreadyImported: partition.alreadyImported,
      allNewEvents,
      allImportedEvents,
      stats,
      dateFilter: {
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
        active: dateRange.active,
      },
      diffOnly,
      warnings: payload.warnings,
    });
  } catch (error) {
    if (error.code === 'HAKKASAN_INVALID_DATE_RANGE') {
      return res.status(400).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    console.error('[scrap-events] GET /hakkasan/events error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'HAKKASAN_SCRAPE_FAILED',
        message: 'Failed to fetch Hakkasan live events',
        details: error.message,
      },
    });
  }
});

/**
 * POST /v1/scrap-events/hakkasan/prepare-import
 */
router.post('/hakkasan/prepare-import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[scrap-events] POST /hakkasan/prepare-import: start', {
      userId: req.user?._id,
      eventCode: req.body?.eventCode,
    });

    const result = await prepareHakkasanEventImport(req.body || {});

    if (result.alreadyImported) {
      return res.json({
        success: true,
        alreadyImported: true,
        eventId: result.eventId,
        eventName: result.eventName,
        hakkasanEventCode: result.hakkasanEventCode,
        message: `Event already imported: ${result.eventName}`,
      });
    }

    res.json({
      success: true,
      alreadyImported: false,
      prefill: result.prefill,
      warnings: result.warnings || [],
      hakkasanEventCode: result.hakkasanEventCode,
    });
  } catch (error) {
    const code = error.code || 'HAKKASAN_PREPARE_IMPORT_FAILED';
    console.error('[scrap-events] POST /hakkasan/prepare-import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(error.code ? 400 : 500).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to prepare Hakkasan event import',
      },
    });
  }
});

/**
 * DELETE /v1/scrap-events/hakkasan/import/:hakkasanEventCode
 */
router.delete('/hakkasan/import/:hakkasanEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { hakkasanEventCode } = req.params;
    console.log('[scrap-events] DELETE /hakkasan/import: start', {
      userId: req.user?._id,
      hakkasanEventCode,
    });

    const result = await undoHakkasanEventImport(hakkasanEventCode);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'HAKKASAN_UNDO_IMPORT_FAILED';
    const status =
      code === 'HAKKASAN_EVENT_NOT_FOUND'
        ? 404
        : code === 'HAKKASAN_EVENT_IN_COE_USE' || code === 'EVENT_HAS_BOOKINGS'
          ? 409
          : error.code
            ? 400
            : 500;
    console.error('[scrap-events] DELETE /hakkasan/import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to undo Hakkasan import',
      },
    });
  }
});

/**
 * POST /v1/scrap-events/hakkasan/resync-pricing/:hakkasanEventCode
 */
router.post('/hakkasan/resync-pricing/:hakkasanEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { hakkasanEventCode } = req.params;
    console.log('[scrap-events] POST /hakkasan/resync-pricing: start', {
      userId: req.user?._id,
      hakkasanEventCode,
    });

    const result = await resyncHakkasanEventPricing(hakkasanEventCode);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'HAKKASAN_RESYNC_PRICING_FAILED';
    const status =
      code === 'HAKKASAN_EVENT_NOT_FOUND'
        ? 404
        : error.code
          ? 400
          : 500;
    console.error('[scrap-events] POST /hakkasan/resync-pricing error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to resync Hakkasan event pricing',
      },
    });
  }
});

/**
 * GET /v1/scrap-events/tao-beach/events
 * @description Preview TAO Beach events from Booketing listing (no database writes).
 */
router.get('/tao-beach/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const diffOnly = req.query.diffOnly !== 'false';
    const dateRange = validateTaoBeachDateRangeQuery(req.query.fromDate, req.query.toDate);

    console.log('[scrap-events] GET /tao-beach/events: start', {
      userId: req.user?._id,
      diffOnly,
      dateFilter: dateRange.active ? { from: dateRange.fromDate, to: dateRange.toDate } : null,
    });

    const payload = await fetchTaoBeachEventsPreview();

    if (payload.browserError) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SCRAP_BROWSER_UNAVAILABLE',
          message: 'Could not load TAO Beach events page in headless browser',
          details: payload.browserError,
        },
        sourceUrl: payload.sourceUrl,
        warnings: payload.warnings,
      });
    }

    const allEvents = payload.events || [];
    const totalScraped = allEvents.length;
    const upcomingEvents = filterTaoBeachEventsNotInPast(allEvents);
    const pastExcludedCount = totalScraped - upcomingEvents.length;

    const partitionAll = await partitionTaoBeachEventsByImportStatus(upcomingEvents);
    const allNewEvents = partitionAll.newEvents;
    const allImportedEvents = partitionAll.alreadyImported;

    const eventsForPartition = dateRange.active
      ? filterTaoBeachEventsByDateRange(upcomingEvents, dateRange.fromDate, dateRange.toDate)
      : upcomingEvents;
    const inDateRangeTotal = eventsForPartition.length;

    const partition = await partitionTaoBeachEventsByImportStatus(eventsForPartition);

    let events;
    if (diffOnly) {
      events = partition.newEvents;
    } else {
      events = [...partition.newEvents, ...partition.alreadyImported];
    }

    const stats = {
      ...partition.stats,
      totalScraped,
      pastExcludedCount,
      upcomingTotal: upcomingEvents.length,
      monthScope: payload.monthScope || null,
      inDateRangeTotal: dateRange.active ? inDateRangeTotal : upcomingEvents.length,
    };

    res.json({
      success: true,
      sourceUrl: payload.sourceUrl,
      scrapedAt: payload.scrapedAt,
      count: events.length,
      events,
      alreadyImported: partition.alreadyImported,
      allNewEvents,
      allImportedEvents,
      stats,
      dateFilter: {
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
        active: dateRange.active,
      },
      diffOnly,
      warnings: payload.warnings,
    });
  } catch (error) {
    if (error.code === 'TAO_BEACH_INVALID_DATE_RANGE') {
      return res.status(400).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    console.error('[scrap-events] GET /tao-beach/events error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'TAO_BEACH_SCRAPE_FAILED',
        message: 'Failed to fetch TAO Beach live events',
        details: error.message,
      },
    });
  }
});

/**
 * POST /v1/scrap-events/tao-beach/prepare-import
 */
router.post('/tao-beach/prepare-import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[scrap-events] POST /tao-beach/prepare-import: start', {
      userId: req.user?._id,
      eventCode: req.body?.eventCode,
    });

    const result = await prepareTaoBeachEventImport(req.body || {});

    if (result.alreadyImported) {
      return res.json({
        success: true,
        alreadyImported: true,
        eventId: result.eventId,
        eventName: result.eventName,
        taoBeachEventCode: result.taoBeachEventCode,
        message: `Event already imported: ${result.eventName}`,
      });
    }

    res.json({
      success: true,
      alreadyImported: false,
      prefill: result.prefill,
      warnings: result.warnings || [],
      taoBeachEventCode: result.taoBeachEventCode,
    });
  } catch (error) {
    const code = error.code || 'TAO_BEACH_PREPARE_IMPORT_FAILED';
    console.error('[scrap-events] POST /tao-beach/prepare-import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(error.code ? 400 : 500).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to prepare TAO Beach event import',
      },
    });
  }
});

/**
 * DELETE /v1/scrap-events/tao-beach/import/:taoBeachEventCode
 */
router.delete('/tao-beach/import/:taoBeachEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { taoBeachEventCode } = req.params;
    console.log('[scrap-events] DELETE /tao-beach/import: start', {
      userId: req.user?._id,
      taoBeachEventCode,
    });

    const result = await undoTaoBeachEventImport(taoBeachEventCode);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'TAO_BEACH_UNDO_IMPORT_FAILED';
    const status =
      code === 'TAO_BEACH_EVENT_NOT_FOUND'
        ? 404
        : code === 'TAO_BEACH_EVENT_IN_COE_USE' || code === 'EVENT_HAS_BOOKINGS'
          ? 409
          : error.code
            ? 400
            : 500;
    console.error('[scrap-events] DELETE /tao-beach/import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to undo TAO Beach import',
      },
    });
  }
});

/**
 * POST /v1/scrap-events/tao-beach/resync-pricing/:taoBeachEventCode
 */
router.post('/tao-beach/resync-pricing/:taoBeachEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { taoBeachEventCode } = req.params;
    console.log('[scrap-events] POST /tao-beach/resync-pricing: start', {
      userId: req.user?._id,
      taoBeachEventCode,
    });

    const result = await resyncTaoBeachEventPricing(taoBeachEventCode);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'TAO_BEACH_RESYNC_PRICING_FAILED';
    const status =
      code === 'TAO_BEACH_EVENT_NOT_FOUND'
        ? 404
        : error.code
          ? 400
          : 500;
    console.error('[scrap-events] POST /tao-beach/resync-pricing error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to resync TAO Beach event pricing',
      },
    });
  }
});

/**
 * GET /v1/scrap-events/palm-tree-beach/events
 * @description Preview Palm Tree Beach events from Booketing listing (no database writes).
 */
router.get('/palm-tree-beach/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const diffOnly = req.query.diffOnly !== 'false';
    const dateRange = validatePalmTreeBeachDateRangeQuery(req.query.fromDate, req.query.toDate);

    console.log('[scrap-events] GET /palm-tree-beach/events: start', {
      userId: req.user?._id,
      diffOnly,
      dateFilter: dateRange.active ? { from: dateRange.fromDate, to: dateRange.toDate } : null,
    });

    const payload = await fetchPalmTreeBeachEventsPreview();

    if (payload.browserError) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SCRAP_BROWSER_UNAVAILABLE',
          message: 'Could not load Palm Tree Beach events page in headless browser',
          details: payload.browserError,
        },
        sourceUrl: payload.sourceUrl,
        warnings: payload.warnings,
      });
    }

    const allEvents = payload.events || [];
    const totalScraped = allEvents.length;
    const upcomingEvents = filterPalmTreeBeachEventsNotInPast(allEvents);
    const pastExcludedCount = totalScraped - upcomingEvents.length;

    const partitionAll = await partitionPalmTreeBeachEventsByImportStatus(upcomingEvents);
    const allNewEvents = partitionAll.newEvents;
    const allImportedEvents = partitionAll.alreadyImported;

    const eventsForPartition = dateRange.active
      ? filterPalmTreeBeachEventsByDateRange(upcomingEvents, dateRange.fromDate, dateRange.toDate)
      : upcomingEvents;
    const inDateRangeTotal = eventsForPartition.length;

    const partition = await partitionPalmTreeBeachEventsByImportStatus(eventsForPartition);

    let events;
    if (diffOnly) {
      events = partition.newEvents;
    } else {
      events = [...partition.newEvents, ...partition.alreadyImported];
    }

    const stats = {
      ...partition.stats,
      totalScraped,
      pastExcludedCount,
      upcomingTotal: upcomingEvents.length,
      monthScope: payload.monthScope || null,
      inDateRangeTotal: dateRange.active ? inDateRangeTotal : upcomingEvents.length,
    };

    res.json({
      success: true,
      sourceUrl: payload.sourceUrl,
      scrapedAt: payload.scrapedAt,
      count: events.length,
      events,
      alreadyImported: partition.alreadyImported,
      allNewEvents,
      allImportedEvents,
      stats,
      dateFilter: {
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
        active: dateRange.active,
      },
      diffOnly,
      warnings: payload.warnings,
    });
  } catch (error) {
    if (error.code === 'PALM_TREE_BEACH_INVALID_DATE_RANGE') {
      return res.status(400).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    console.error('[scrap-events] GET /palm-tree-beach/events error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'PALM_TREE_BEACH_SCRAPE_FAILED',
        message: 'Failed to fetch Palm Tree Beach live events',
        details: error.message,
      },
    });
  }
});

/**
 * POST /v1/scrap-events/palm-tree-beach/prepare-import
 */
router.post('/palm-tree-beach/prepare-import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[scrap-events] POST /palm-tree-beach/prepare-import: start', {
      userId: req.user?._id,
      eventCode: req.body?.eventCode,
    });

    const result = await preparePalmTreeBeachImport(req.body || {});

    if (result.alreadyImported) {
      return res.json({
        success: true,
        alreadyImported: true,
        eventId: result.eventId,
        eventName: result.eventName,
        palmTreeBeachEventCode: result.palmTreeBeachEventCode,
        message: `Event already imported: ${result.eventName}`,
      });
    }

    res.json({
      success: true,
      alreadyImported: false,
      prefill: result.prefill,
      warnings: result.warnings || [],
      palmTreeBeachEventCode: result.palmTreeBeachEventCode,
    });
  } catch (error) {
    const code = error.code || 'PALM_TREE_BEACH_PREPARE_IMPORT_FAILED';
    console.error('[scrap-events] POST /palm-tree-beach/prepare-import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(error.code ? 400 : 500).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to prepare Palm Tree Beach event import',
      },
    });
  }
});

/**
 * DELETE /v1/scrap-events/palm-tree-beach/import/:palmTreeBeachEventCode
 */
router.delete('/palm-tree-beach/import/:palmTreeBeachEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { palmTreeBeachEventCode } = req.params;
    console.log('[scrap-events] DELETE /palm-tree-beach/import: start', {
      userId: req.user?._id,
      palmTreeBeachEventCode,
    });

    const result = await undoPalmTreeBeachImport(palmTreeBeachEventCode);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'PALM_TREE_BEACH_UNDO_IMPORT_FAILED';
    const status =
      code === 'PALM_TREE_BEACH_EVENT_NOT_FOUND'
        ? 404
        : code === 'PALM_TREE_BEACH_EVENT_IN_COE_USE' || code === 'EVENT_HAS_BOOKINGS'
          ? 409
          : error.code
            ? 400
            : 500;
    console.error('[scrap-events] DELETE /palm-tree-beach/import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to undo Palm Tree Beach import',
      },
    });
  }
});

/**
 * POST /v1/scrap-events/palm-tree-beach/resync-pricing/:palmTreeBeachEventCode
 */
router.post('/palm-tree-beach/resync-pricing/:palmTreeBeachEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { palmTreeBeachEventCode } = req.params;
    console.log('[scrap-events] POST /palm-tree-beach/resync-pricing: start', {
      userId: req.user?._id,
      palmTreeBeachEventCode,
    });

    const result = await resyncPalmTreeBeachEventPricing(palmTreeBeachEventCode);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'PALM_TREE_BEACH_RESYNC_PRICING_FAILED';
    const status =
      code === 'PALM_TREE_BEACH_EVENT_NOT_FOUND'
        ? 404
        : error.code
          ? 400
          : 500;
    console.error('[scrap-events] POST /palm-tree-beach/resync-pricing error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to resync Palm Tree Beach event pricing',
      },
    });
  }
});

/**
 * GET /v1/scrap-events/marquee-dayclub/events
 * @description Preview Marquee Dayclub events from Booketing listing (no database writes).
 */
router.get('/marquee-dayclub/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const diffOnly = req.query.diffOnly !== 'false';
    const dateRange = validateMarqueeDayclubDateRangeQuery(req.query.fromDate, req.query.toDate);

    console.log('[scrap-events] GET /marquee-dayclub/events: start', {
      userId: req.user?._id,
      diffOnly,
      dateFilter: dateRange.active ? { from: dateRange.fromDate, to: dateRange.toDate } : null,
    });

    const payload = await fetchMarqueeDayclubEventsPreview();

    if (payload.browserError) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SCRAP_BROWSER_UNAVAILABLE',
          message: 'Could not load Marquee Dayclub events page in headless browser',
          details: payload.browserError,
        },
        sourceUrl: payload.sourceUrl,
        warnings: payload.warnings,
      });
    }

    const allEvents = payload.events || [];
    const totalScraped = allEvents.length;
    const upcomingEvents = filterMarqueeDayclubEventsNotInPast(allEvents);
    const pastExcludedCount = totalScraped - upcomingEvents.length;

    const partitionAll = await partitionMarqueeDayclubEventsByImportStatus(upcomingEvents);
    const allNewEvents = partitionAll.newEvents;
    const allImportedEvents = partitionAll.alreadyImported;

    const eventsForPartition = dateRange.active
      ? filterMarqueeDayclubEventsByDateRange(upcomingEvents, dateRange.fromDate, dateRange.toDate)
      : upcomingEvents;
    const inDateRangeTotal = eventsForPartition.length;

    const partition = await partitionMarqueeDayclubEventsByImportStatus(eventsForPartition);

    let events;
    if (diffOnly) {
      events = partition.newEvents;
    } else {
      events = [...partition.newEvents, ...partition.alreadyImported];
    }

    const stats = {
      ...partition.stats,
      totalScraped,
      pastExcludedCount,
      upcomingTotal: upcomingEvents.length,
      monthScope: payload.monthScope || null,
      inDateRangeTotal: dateRange.active ? inDateRangeTotal : upcomingEvents.length,
    };

    res.json({
      success: true,
      sourceUrl: payload.sourceUrl,
      scrapedAt: payload.scrapedAt,
      count: events.length,
      events,
      alreadyImported: partition.alreadyImported,
      allNewEvents,
      allImportedEvents,
      stats,
      dateFilter: {
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
        active: dateRange.active,
      },
      diffOnly,
      warnings: payload.warnings,
    });
  } catch (error) {
    if (error.code === 'MARQUEE_DAYCLUB_INVALID_DATE_RANGE') {
      return res.status(400).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    console.error('[scrap-events] GET /marquee-dayclub/events error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'MARQUEE_DAYCLUB_SCRAPE_FAILED',
        message: 'Failed to fetch Marquee Dayclub live events',
        details: error.message,
      },
    });
  }
});

/**
 * POST /v1/scrap-events/marquee-dayclub/prepare-import
 */
router.post('/marquee-dayclub/prepare-import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[scrap-events] POST /marquee-dayclub/prepare-import: start', {
      userId: req.user?._id,
      eventCode: req.body?.eventCode,
    });

    const result = await prepareMarqueeDayclubImport(req.body || {});

    if (result.alreadyImported) {
      return res.json({
        success: true,
        alreadyImported: true,
        eventId: result.eventId,
        eventName: result.eventName,
        marqueeDayclubEventCode: result.marqueeDayclubEventCode,
        message: `Event already imported: ${result.eventName}`,
      });
    }

    res.json({
      success: true,
      alreadyImported: false,
      prefill: result.prefill,
      warnings: result.warnings || [],
      marqueeDayclubEventCode: result.marqueeDayclubEventCode,
    });
  } catch (error) {
    const code = error.code || 'MARQUEE_DAYCLUB_PREPARE_IMPORT_FAILED';
    console.error('[scrap-events] POST /marquee-dayclub/prepare-import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(error.code ? 400 : 500).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to prepare Marquee Dayclub event import',
      },
    });
  }
});

/**
 * DELETE /v1/scrap-events/marquee-dayclub/import/:marqueeDayclubEventCode
 */
router.delete('/marquee-dayclub/import/:marqueeDayclubEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { marqueeDayclubEventCode } = req.params;
    console.log('[scrap-events] DELETE /marquee-dayclub/import: start', {
      userId: req.user?._id,
      marqueeDayclubEventCode,
    });

    const result = await undoMarqueeDayclubImport(marqueeDayclubEventCode);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'MARQUEE_DAYCLUB_UNDO_IMPORT_FAILED';
    const status =
      code === 'MARQUEE_DAYCLUB_EVENT_NOT_FOUND'
        ? 404
        : code === 'MARQUEE_DAYCLUB_EVENT_IN_COE_USE' || code === 'EVENT_HAS_BOOKINGS'
          ? 409
          : error.code
            ? 400
            : 500;
    console.error('[scrap-events] DELETE /marquee-dayclub/import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to undo Marquee Dayclub import',
      },
    });
  }
});

/**
 * POST /v1/scrap-events/marquee-dayclub/resync-pricing/:marqueeDayclubEventCode
 */
router.post('/marquee-dayclub/resync-pricing/:marqueeDayclubEventCode', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { marqueeDayclubEventCode } = req.params;
    console.log('[scrap-events] POST /marquee-dayclub/resync-pricing: start', {
      userId: req.user?._id,
      marqueeDayclubEventCode,
    });

    const result = await resyncMarqueeDayclubEventPricing(marqueeDayclubEventCode);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'MARQUEE_DAYCLUB_RESYNC_PRICING_FAILED';
    const status =
      code === 'MARQUEE_DAYCLUB_EVENT_NOT_FOUND'
        ? 404
        : error.code
          ? 400
          : 500;
    console.error('[scrap-events] POST /marquee-dayclub/resync-pricing error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to resync Marquee Dayclub event pricing',
      },
    });
  }
});

/**
 * GET /v1/scrap-events/marquee-nightclub/events
 * @description Preview Marquee Nightclub events from taogroup.com listing (no database writes).
 */
router.get('/marquee-nightclub/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const diffOnly = req.query.diffOnly !== 'false';
    const dateRange = validateMarqueeNightclubDateRangeQuery(req.query.fromDate, req.query.toDate);

    console.log('[scrap-events] GET /marquee-nightclub/events: start', {
      userId: req.user?._id,
      diffOnly,
      dateFilter: dateRange.active ? { from: dateRange.fromDate, to: dateRange.toDate } : null,
    });

    const payload = await fetchMarqueeNightclubEventsPreview();

    if (payload.browserError) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SCRAP_BROWSER_UNAVAILABLE',
          message: 'Could not load Marquee Nightclub events page in headless browser',
          details: payload.browserError,
        },
        sourceUrl: payload.sourceUrl,
        warnings: payload.warnings,
      });
    }

    const allEvents = payload.events || [];
    const totalScraped = allEvents.length;
    const upcomingEvents = filterMarqueeNightclubEventsNotInPast(allEvents);
    const pastExcludedCount = totalScraped - upcomingEvents.length;

    const partitionAll = await partitionMarqueeNightclubEventsByImportStatus(upcomingEvents);
    const allNewEvents = partitionAll.newEvents;
    const allImportedEvents = partitionAll.alreadyImported;

    const eventsForPartition = dateRange.active
      ? filterMarqueeNightclubEventsByDateRange(upcomingEvents, dateRange.fromDate, dateRange.toDate)
      : upcomingEvents;
    const inDateRangeTotal = eventsForPartition.length;

    const partition = await partitionMarqueeNightclubEventsByImportStatus(eventsForPartition);

    let events;
    if (diffOnly) {
      events = partition.newEvents;
    } else {
      events = [...partition.newEvents, ...partition.alreadyImported];
    }

    const stats = {
      ...partition.stats,
      totalScraped,
      pastExcludedCount,
      upcomingTotal: upcomingEvents.length,
      inDateRangeTotal: dateRange.active ? inDateRangeTotal : upcomingEvents.length,
    };

    res.json({
      success: true,
      sourceUrl: payload.sourceUrl,
      scrapedAt: payload.scrapedAt,
      count: events.length,
      events,
      alreadyImported: partition.alreadyImported,
      allNewEvents,
      allImportedEvents,
      skipped: partition.skipped,
      stats,
      dateFilter: {
        fromDate: dateRange.fromDate,
        toDate: dateRange.toDate,
        active: dateRange.active,
      },
      diffOnly,
      warnings: payload.warnings,
    });
  } catch (error) {
    if (error.code === 'MARQUEE_NIGHTCLUB_INVALID_DATE_RANGE') {
      return res.status(400).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
    }
    console.error('[scrap-events] GET /marquee-nightclub/events error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'MARQUEE_NIGHTCLUB_SCRAPE_FAILED',
        message: 'Failed to fetch Marquee Nightclub live events',
        details: error.message,
      },
    });
  }
});

/**
 * POST /v1/scrap-events/marquee-nightclub/prepare-import
 */
router.post('/marquee-nightclub/prepare-import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[scrap-events] POST /marquee-nightclub/prepare-import: start', {
      userId: req.user?._id,
      eventId: req.body?.eventId,
    });

    const result = await prepareMarqueeNightclubImport(req.body || {});

    if (result.alreadyImported) {
      return res.json({
        success: true,
        alreadyImported: true,
        eventId: result.eventId,
        eventName: result.eventName,
        marqueeNightclubEventId: result.marqueeNightclubEventId,
        message: `Event already imported: ${result.eventName}`,
      });
    }

    res.json({
      success: true,
      alreadyImported: false,
      prefill: result.prefill,
      warnings: result.warnings || [],
      marqueeNightclubEventId: result.marqueeNightclubEventId,
    });
  } catch (error) {
    const code = error.code || 'MARQUEE_NIGHTCLUB_PREPARE_IMPORT_FAILED';
    console.error('[scrap-events] POST /marquee-nightclub/prepare-import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(error.code ? 400 : 500).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to prepare Marquee Nightclub event import',
      },
    });
  }
});

/**
 * DELETE /v1/scrap-events/marquee-nightclub/import/:marqueeNightclubEventId
 */
router.delete('/marquee-nightclub/import/:marqueeNightclubEventId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { marqueeNightclubEventId } = req.params;
    console.log('[scrap-events] DELETE /marquee-nightclub/import: start', {
      userId: req.user?._id,
      marqueeNightclubEventId,
    });

    const result = await undoMarqueeNightclubImport(marqueeNightclubEventId);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'MARQUEE_NIGHTCLUB_UNDO_IMPORT_FAILED';
    const status =
      code === 'MARQUEE_NIGHTCLUB_EVENT_NOT_FOUND'
        ? 404
        : code === 'MARQUEE_NIGHTCLUB_EVENT_IN_COE_USE' || code === 'EVENT_HAS_BOOKINGS'
          ? 409
          : error.code
            ? 400
            : 500;
    console.error('[scrap-events] DELETE /marquee-nightclub/import error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to undo Marquee Nightclub import',
      },
    });
  }
});

/**
 * POST /v1/scrap-events/marquee-nightclub/resync-pricing/:marqueeNightclubEventId
 */
router.post('/marquee-nightclub/resync-pricing/:marqueeNightclubEventId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { marqueeNightclubEventId } = req.params;
    console.log('[scrap-events] POST /marquee-nightclub/resync-pricing: start', {
      userId: req.user?._id,
      marqueeNightclubEventId,
    });

    const result = await resyncMarqueeNightclubEventPricing(marqueeNightclubEventId);

    res.json({ success: true, ...result });
  } catch (error) {
    const code = error.code || 'MARQUEE_NIGHTCLUB_RESYNC_PRICING_FAILED';
    const status =
      code === 'MARQUEE_NIGHTCLUB_EVENT_NOT_FOUND'
        ? 404
        : error.code
          ? 400
          : 500;
    console.error('[scrap-events] POST /marquee-nightclub/resync-pricing error:', {
      code,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(status).json({
      success: false,
      error: {
        code,
        message: error.message || 'Failed to resync Marquee Nightclub event pricing',
      },
    });
  }
});

module.exports = router;
