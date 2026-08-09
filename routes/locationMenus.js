const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const Location = require('../models/Location');
const VenueMenu = require('../models/VenueMenu');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { upsertVenueMenuSchema } = require('../utils/validationSchemas');

const router = express.Router({ mergeParams: true });

const menusDir = path.join(__dirname, '..', 'public', 'menus');
if (!fs.existsSync(menusDir)) {
  fs.mkdirSync(menusDir, { recursive: true });
}

const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, menusDir),
    filename: (req, file, cb) => {
      const locId = String(req.params.id || 'unknown');
      const safe = String(file.originalname || 'menu.pdf')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 80);
      cb(null, `${locId}-${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      (file.originalname || '').toLowerCase().endsWith('.pdf');
    if (!ok) {
      return cb(new Error('Only PDF files are allowed'));
    }
    return cb(null, true);
  },
});

/**
 * Normalize menu sections/items for persistence.
 * @param {object[]} sections
 * @returns {object[]}
 */
function normalizeSections(sections) {
  if (!Array.isArray(sections)) {
    return [];
  }
  return sections.map((section, sIdx) => ({
    name: String(section?.name || '').trim(),
    sortOrder:
      typeof section?.sortOrder === 'number' ? section.sortOrder : sIdx,
    items: Array.isArray(section?.items)
      ? section.items.map((item, iIdx) => ({
          name: String(item?.name || '').trim(),
          description: String(item?.description || '').trim(),
          price:
            item?.price === null || item?.price === undefined || item?.price === ''
              ? null
              : Number(item.price),
          priceLabel: String(item?.priceLabel || '').trim(),
          sortOrder:
            typeof item?.sortOrder === 'number' ? item.sortOrder : iIdx,
          available: item?.available !== false,
        }))
      : [],
  }));
}

/**
 * GET /v1/locations/:id/menu
 * Fetch venue menu for a location (admin).
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const locationId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(locationId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid location id' },
      });
    }

    const location = await Location.findById(locationId).select('name type').lean();
    if (!location) {
      return res.status(404).json({
        success: false,
        error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' },
      });
    }

    const menu = await VenueMenu.findOne({ location_id: locationId }).lean();
    if (!menu) {
      return res.status(404).json({
        success: false,
        error: { code: 'MENU_NOT_FOUND', message: 'No menu for this location' },
        data: { location },
      });
    }

    return res.json({
      success: true,
      data: { menu, location },
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] GET location menu error:`, err);
    return res.status(500).json({
      success: false,
      error: { code: 'MENU_FETCH_FAILED', message: 'Failed to fetch venue menu' },
    });
  }
});

/**
 * PUT /v1/locations/:id/menu
 * Upsert full venue menu for a location (admin).
 */
router.put('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const locationId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(locationId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ID', message: 'Invalid location id' },
      });
    }

    const { error, value } = upsertVenueMenuSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid menu payload',
          details: error.details.map(d => d.message),
        },
      });
    }

    const location = await Location.findById(locationId).select('name').lean();
    if (!location) {
      return res.status(404).json({
        success: false,
        error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' },
      });
    }

    const sections = normalizeSections(value.sections);
    const update = {
      location_id: locationId,
      title: value.title || `${location.name} Menu`,
      status: value.status || 'active',
      currency: value.currency || 'USD',
      notes: value.notes || '',
      sections,
    };
    if (value.sourcePdfUrl !== undefined) {
      update.sourcePdfUrl = value.sourcePdfUrl || '';
    }

    const menu = await VenueMenu.findOneAndUpdate(
      { location_id: locationId },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    return res.json({
      success: true,
      message: 'Venue menu saved',
      data: { menu, location },
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] PUT location menu error:`, err);
    return res.status(500).json({
      success: false,
      error: { code: 'MENU_SAVE_FAILED', message: 'Failed to save venue menu' },
    });
  }
});

/**
 * POST /v1/locations/:id/menu/pdf
 * Upload a source PDF and attach it to the venue menu (admin).
 */
router.post(
  '/pdf',
  authenticateToken,
  requireAdmin,
  (req, res, next) => {
    pdfUpload.single('pdf')(req, res, err => {
      if (err) {
        return res.status(400).json({
          success: false,
          error: { code: 'UPLOAD_ERROR', message: err.message || 'PDF upload failed' },
        });
      }
      return next();
    });
  },
  async (req, res) => {
    try {
      const locationId = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(locationId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Invalid location id' },
        });
      }
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_FILE', message: 'No PDF uploaded. Field name must be "pdf".' },
        });
      }

      const location = await Location.findById(locationId).select('name').lean();
      if (!location) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {
          /* ignore */
        }
        return res.status(404).json({
          success: false,
          error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' },
        });
      }

      const sourcePdfUrl = `/menus/${req.file.filename}`;
      const menu = await VenueMenu.findOneAndUpdate(
        { location_id: locationId },
        {
          $set: {
            sourcePdfUrl,
            location_id: locationId,
          },
          $setOnInsert: {
            title: `${location.name} Menu`,
            status: 'active',
            currency: 'USD',
            sections: [],
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      return res.json({
        success: true,
        message: 'Menu PDF uploaded',
        data: { menu, location, sourcePdfUrl },
      });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] POST location menu pdf error:`, err);
      return res.status(500).json({
        success: false,
        error: { code: 'MENU_PDF_UPLOAD_FAILED', message: 'Failed to upload menu PDF' },
      });
    }
  },
);

module.exports = router;
