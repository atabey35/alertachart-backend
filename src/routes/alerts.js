/**
 * Price alerts management routes
 */

import express from 'express';
import {
  createPriceAlert,
  getPriceAlerts,
  deletePriceAlert,
} from '../lib/push/db.js';

const router = express.Router();

/**
 * POST /api/alerts/price
 * Create new price alert
 */
router.post('/price', async (req, res) => {
  try {
    const { deviceId, symbol, targetPrice, proximityDelta, direction } = req.body;

    // Validation
    if (!deviceId || !symbol || !targetPrice || !proximityDelta || !direction) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({
        error: 'Invalid direction. Must be "up" or "down"'
      });
    }

    const alert = await createPriceAlert(
      deviceId,
      symbol,
      parseFloat(targetPrice),
      parseFloat(proximityDelta),
      direction
    );

    console.log(`✅ Price alert created: ${symbol} @ ${targetPrice} (${direction})`);

    res.json({ success: true, alert });
  } catch (error) {
    console.error('Error creating price alert:', error);
    res.status(500).json({
      error: error.message || 'Failed to create price alert'
    });
  }
});

/**
 * GET /api/alerts/price?deviceId=xxx
 * Get all price alerts for device
 */
router.get('/price', async (req, res) => {
  try {
    const { deviceId } = req.query;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    const alerts = await getPriceAlerts(deviceId);

    res.json({ alerts });
  } catch (error) {
    console.error('Error fetching price alerts:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch price alerts'
    });
  }
});

/**
 * DELETE /api/alerts/price
 * Delete price alert
 */
router.delete('/price', async (req, res) => {
  try {
    const { id, deviceId } = req.body;

    if (!id || !deviceId) {
      return res.status(400).json({
        error: 'Missing id or deviceId'
      });
    }

    await deletePriceAlert(parseInt(id), deviceId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting price alert:', error);
    res.status(500).json({
      error: error.message || 'Failed to delete price alert'
    });
  }
});

export default router;

