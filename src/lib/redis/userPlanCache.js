/**
 * Redis Cache Helper for User Plan
 * 
 * This helper function provides millisecond-level response times
 * for premium status checks by using Redis caching.
 * 
 * Usage:
 * 1. Install ioredis: npm install ioredis
 * 2. Set REDIS_URL environment variable
 * 3. Import and use getCachedUserPlan in /api/user/plan route
 */

const Redis = require('ioredis');

// Redis connection (singleton)
let redis = null;

function getRedis() {
    if (!redis) {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            console.warn('[Redis] REDIS_URL not found, caching disabled');
            return null;
        }
        redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            lazyConnect: true,
        });
        redis.on('error', (err) => {
            console.error('[Redis] Connection error:', err);
        });
    }
    return redis;
}

/**
 * Cache TTL in seconds
 * - Short TTL (5 min) ensures subscription changes are reflected quickly
 * - Long enough to avoid excessive DB queries
 */
const CACHE_TTL = 300; // 5 minutes

/**
 * Get user plan from cache or database
 * 
 * @param {string} userEmail - User's email address
 * @param {function} fetchFromDb - Function that fetches user plan from database and returns user object
 * @returns {Promise<{user: object, fromCache: boolean}>}
 */
async function getCachedUserPlan(userEmail, fetchFromDb) {
    const cacheKey = `user_plan:${userEmail}`;
    const client = getRedis();

    // If Redis not available, fall back to DB
    if (!client) {
        const user = await fetchFromDb();
        return { user, fromCache: false };
    }

    try {
        // Check cache first
        const cached = await client.get(cacheKey);
        if (cached) {
            console.log('[Redis] ✅ Cache HIT for user plan:', userEmail);
            return { user: JSON.parse(cached), fromCache: true };
        }

        // Cache miss - fetch from DB
        console.log('[Redis] Cache MISS for user plan:', userEmail);
        const user = await fetchFromDb();

        // Store in cache (async - don't wait)
        if (user) {
            client.setex(cacheKey, CACHE_TTL, JSON.stringify(user)).catch((err) => {
                console.error('[Redis] Error caching user plan:', err);
            });
        }

        return { user, fromCache: false };
    } catch (err) {
        console.error('[Redis] Error getting cached user plan:', err);
        // Fall back to DB on any Redis error
        const user = await fetchFromDb();
        return { user, fromCache: false };
    }
}

/**
 * Invalidate user plan cache
 * Call this when subscription status changes (webhook handlers)
 * 
 * @param {string} userEmail - User's email address
 */
async function invalidateUserPlanCache(userEmail) {
    const cacheKey = `user_plan:${userEmail}`;
    const client = getRedis();

    if (!client) return;

    try {
        await client.del(cacheKey);
        console.log('[Redis] ✅ Cache invalidated for user plan:', userEmail);
    } catch (err) {
        console.error('[Redis] Error invalidating user plan cache:', err);
    }
}

module.exports = {
    getCachedUserPlan,
    invalidateUserPlanCache,
    getRedis,
};

/**
 * Example usage in /api/user/plan route:
 * 
 * const { getCachedUserPlan, invalidateUserPlanCache } = require('@/lib/redis/userPlanCache');
 * 
 * // In GET handler:
 * const { user, fromCache } = await getCachedUserPlan(userEmail, async () => {
 *   const users = await sql`SELECT * FROM users WHERE email = ${userEmail} LIMIT 1`;
 *   return users[0] || null;
 * });
 * 
 * // In webhook handler (after subscription update):
 * await invalidateUserPlanCache(userEmail);
 */
