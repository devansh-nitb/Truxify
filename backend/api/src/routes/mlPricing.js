/**
 * ML Pricing Routes
 * Exposes endpoints for demand prediction and pricing search.
 * Protected by strict rate limiting and price obfuscation.
 */
import express from 'express';
import axios from 'axios';
import { strictMlRateLimiter } from '../middleware/mlRateLimiter.js';
import { applyPriceObfuscation } from '../services/priceObfuscation.js';
import logger from '../middleware/logger.js';

const router = express.Router();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000/ml';

/**
 * Validate request body for ML endpoints
 */
function validateMlRequest(req, res, next) {
    const { origin, destination } = req.body;
    if (!origin || typeof origin !== 'string' || origin.trim().length < 3) {
        return res.status(400).json({ error: 'Invalid or missing origin. Must be a string of at least 3 characters.' });
    }
    if (!destination || typeof destination !== 'string' || destination.trim().length < 3) {
        return res.status(400).json({ error: 'Invalid or missing destination. Must be a string of at least 3 characters.' });
    }
    next();
}

/**
 * @route POST /api/v1/ml/predict-demand
 * @desc Predicts demand for a specific route and time.
 * @access Public (with strict rate limits) or Private
 */
router.post('/predict-demand', strictMlRateLimiter, validateMlRequest, async (req, res) => {
    try {
        const { origin, destination, date, cargoType } = req.body;

        // Call the actual ML service
        let mlResponse;
        try {
            const response = await axios.post(`${ML_SERVICE_URL}/predict-demand`, {
                origin,
                destination,
                date,
                cargoType
            }, { timeout: 5000 });
            mlResponse = response.data;
        } catch (error) {
            logger.warn({ err: error.message }, '[MLPricing] ML service unavailable or failed. Using fallback mock data.');
            mlResponse = {
                demandScore: 0.85,
                estimatedPrice: 15000,
                confidence: 0.92
            };
        }

        // Apply obfuscation to the estimated price
        const userId = req.user?.id || null;
        const finalEstimatedPrice = await applyPriceObfuscation(mlResponse.estimatedPrice, userId);

        res.json({
            success: true,
            data: {
                ...mlResponse,
                estimatedPrice: finalEstimatedPrice
            }
        });
    } catch (err) {
        logger.error({ err, body: req.body }, '[MLPricing] Error in predict-demand endpoint');
        res.status(500).json({ error: 'Internal server error while predicting demand.' });
    }
});

/**
 * @route POST /api/v1/ml/search
 * @desc Searches for available loads/trucks with ML-optimized pricing.
 * @access Public (with strict rate limits) or Private
 */
router.post('/search', strictMlRateLimiter, validateMlRequest, async (req, res) => {
    try {
        const { origin, destination, vehicleType, maxPrice } = req.body;

        // Call actual ML service for search
        let mlResponse;
        try {
            const response = await axios.post(`${ML_SERVICE_URL}/search-loads`, {
                origin,
                destination,
                vehicleType,
                maxPrice
            }, { timeout: 5000 });
            mlResponse = response.data;
        } catch (error) {
            logger.warn({ err: error.message }, '[MLPricing] ML search service unavailable or failed. Using fallback mock data.');
            mlResponse = {
                results: [
                    { id: 'load-1', price: 12000, distance: 450 },
                    { id: 'load-2', price: 13500, distance: 460 }
                ]
            };
        }

        // Apply obfuscation to each result's price
        const userId = req.user?.id || null;
        const obfuscatedResults = await Promise.all(
            mlResponse.results.map(async (item) => {
                const obfuscatedPrice = await applyPriceObfuscation(item.price, userId);
                return { ...item, price: obfuscatedPrice };
            })
        );

        res.json({
            success: true,
            data: {
                results: obfuscatedResults
            }
        });
    } catch (err) {
        logger.error({ err, body: req.body }, '[MLPricing] Error in search endpoint');
        res.status(500).json({ error: 'Internal server error while searching.' });
    }
});

export default router;
