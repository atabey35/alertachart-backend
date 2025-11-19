/**
 * Push notification database operations (Neon PostgreSQL)
 */

import { neon } from '@neondatabase/serverless';

let sql = null;

function getSql() {
  if (!sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

/**
 * Initialize push notification database tables
 */
export async function initPushDatabase() {
  const sql = getSql();
  try {
    // Devices table
    await sql`
      CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(255) UNIQUE NOT NULL,
        expo_push_token VARCHAR(500) NOT NULL,
        platform VARCHAR(20) NOT NULL,
        app_version VARCHAR(50),
        user_id INTEGER,
        model VARCHAR(100),
        os_version VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    // Add new columns if they don't exist (migration)
    try {
      await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS user_id INTEGER`;
      await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS model VARCHAR(100)`;
      await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS os_version VARCHAR(50)`;
      console.log('✅ Devices table migration completed');
    } catch (migrationError) {
      console.log('ℹ️  Devices table already has new columns');
    }

    // Price alerts table
    await sql`
      CREATE TABLE IF NOT EXISTS price_alerts (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(255) NOT NULL,
        user_id INTEGER,
        symbol VARCHAR(50) NOT NULL,
        target_price DECIMAL(20, 8) NOT NULL,
        proximity_delta DECIMAL(20, 8) NOT NULL,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('up', 'down')),
        is_active BOOLEAN DEFAULT true,
        last_notified_at TIMESTAMP,
        last_price DECIMAL(20, 8),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
      )
    `;
    
    // Add user_id column if it doesn't exist (migration)
    try {
      await sql`ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS user_id INTEGER`;
      // Add foreign key constraint if it doesn't exist
      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'fk_price_alerts_user_id'
          ) THEN
            ALTER TABLE price_alerts 
            ADD CONSTRAINT fk_price_alerts_user_id 
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
          END IF;
        END $$;
      `;
      console.log('✅ Price alerts table migration completed (user_id added)');
    } catch (migrationError) {
      console.log('ℹ️  Price alerts table already has user_id column');
    }

    // Alarm subscriptions table
    await sql`
      CREATE TABLE IF NOT EXISTS alarm_subscriptions (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(255) NOT NULL,
        alarm_key VARCHAR(255) NOT NULL,
        symbol VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        last_notified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(device_id, alarm_key),
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
      )
    `;

    // Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_devices_active ON devices(is_active)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_price_alerts_device_id ON price_alerts(device_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_price_alerts_user_id ON price_alerts(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol ON price_alerts(symbol)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol_active ON price_alerts(symbol, is_active)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_alarm_subscriptions_device_id ON alarm_subscriptions(device_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_alarm_subscriptions_alarm_key ON alarm_subscriptions(alarm_key)`;

    console.log('✅ Push notification database initialized');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize push database:', error);
    throw error;
  }
}

// Device operations
export async function upsertDevice(deviceId, expoPushToken, platform, appVersion, userId = null, model = null, osVersion = null) {
  const sql = getSql();
  
  // 🔥 CRITICAL FIX: If userId is provided, always update user_id (even if device already exists)
  // This ensures login users can link their devices automatically
  // COALESCE logic: If userId is provided (not null), use it. Otherwise, keep existing user_id.
  // But if existing user_id is NULL and userId is provided, we want to link it!
  // 🔥 FIX: Handle null values for model, osVersion, and appVersion to avoid PostgreSQL type inference errors
  // Use explicit ::text casts for all string parameters
  const result = await sql`
    INSERT INTO devices (device_id, expo_push_token, platform, app_version, user_id, model, os_version, updated_at)
    VALUES (
      ${deviceId}, 
      ${expoPushToken}, 
      ${platform}::text, 
      ${appVersion || '1.0.0'}::text, 
      ${userId}, 
      ${model || null}::text, 
      ${osVersion || null}::text, 
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (device_id)
    DO UPDATE SET
      -- 🔥 FIX: Only update push token if provided (not null)
      -- This prevents overwriting existing push token when linking device without push token
      expo_push_token = CASE 
        WHEN ${expoPushToken}::text IS NOT NULL THEN ${expoPushToken}::text
        ELSE devices.expo_push_token
      END,
      platform = ${platform}::text,
      app_version = CASE 
        WHEN ${appVersion}::text IS NOT NULL THEN ${appVersion}::text
        ELSE devices.app_version
      END,
      -- 🔥 FIX: If userId is provided, use it. Otherwise, keep existing user_id.
      -- This allows linking devices on login (when userId is provided)
      -- Cast to integer to help PostgreSQL type inference
      user_id = CASE 
        WHEN ${userId}::integer IS NOT NULL THEN ${userId}::integer
        ELSE devices.user_id
      END,
      -- 🔥 FIX: Only update model/os_version if provided (not null)
      -- Cast to text in CASE WHEN clause to help PostgreSQL type inference
      model = CASE 
        WHEN ${model}::text IS NOT NULL THEN ${model}::text
        ELSE devices.model
      END,
      os_version = CASE 
        WHEN ${osVersion}::text IS NOT NULL THEN ${osVersion}::text
        ELSE devices.os_version
      END,
      is_active = true,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;
  
  // Debug log
  if (userId) {
    console.log(`[upsertDevice] ✅ Device ${deviceId} linked to user ${userId}`);
  } else {
    console.log(`[upsertDevice] ⚠️  Device ${deviceId} registered without user_id (will be linked on login)`);
  }
  
  return result[0];
}

export async function getDevice(deviceId) {
  const sql = getSql();
  const result = await sql`
    SELECT * FROM devices
    WHERE device_id = ${deviceId} AND is_active = true
  `;
  return result[0];
}

export async function deactivateDevice(deviceId) {
  const sql = getSql();
  await sql`
    UPDATE devices
    SET is_active = false, updated_at = CURRENT_TIMESTAMP
    WHERE device_id = ${deviceId}
  `;
}

export async function deleteDeviceByToken(token) {
  const sql = getSql();
  const result = await sql`
    DELETE FROM devices
    WHERE expo_push_token = ${token}
    RETURNING *
  `;
  return result[0];
}

export async function getAllActiveDevices() {
  const sql = getSql();
  return await sql`
    SELECT * FROM devices
    WHERE is_active = true
  `;
}

/**
 * Get all active devices for premium/trial users only
 * This is optimized to fetch devices and user info in a single query
 * 
 * FIX: Artık tüm premium/trial kullanıcıların cihazlarını tek sorguda çekiyor
 * Önceki kod her cihaz için ayrı getUserById çağırıyordu - bu yüzden sadece 1 cihaz buluyordu!
 */
export async function getPremiumTrialDevices() {
  const sql = getSql();
  
  // Use CURRENT_TIMESTAMP for better PostgreSQL compatibility
  // This ensures we're using database server time, not client time
  return await sql`
    SELECT 
      d.id,
      d.device_id,
      d.expo_push_token,
      d.platform,
      d.app_version,
      d.user_id,
      d.model,
      d.os_version,
      u.plan,
      u.expiry_date,
      u.trial_started_at,
      u.trial_ended_at,
      u.email
    FROM devices d
    INNER JOIN users u ON d.user_id = u.id
    WHERE d.is_active = true
      AND u.is_active = true
      AND d.user_id IS NOT NULL
      AND (
        -- Premium users (with or without expiry)
        (u.plan = 'premium' AND (u.expiry_date IS NULL OR u.expiry_date > CURRENT_TIMESTAMP))
        OR
        -- Trial users (active trial)
        (
          u.plan = 'free' 
          AND u.trial_started_at IS NOT NULL
          AND u.trial_started_at <= CURRENT_TIMESTAMP
          AND (
            -- Trial ended_at yoksa, 3 gün hesapla
            (u.trial_ended_at IS NULL AND (u.trial_started_at + INTERVAL '3 days') > CURRENT_TIMESTAMP)
            OR
            -- Trial ended_at varsa, kontrol et
            (u.trial_ended_at IS NOT NULL AND u.trial_ended_at > CURRENT_TIMESTAMP)
          )
        )
      )
    ORDER BY d.user_id, d.id
  `;
}

// Price alert operations
export async function createPriceAlert(deviceId, symbol, targetPrice, proximityDelta, direction, userId = null) {
  const sql = getSql();
  
  // If userId not provided, get it from device
  if (!userId) {
    const device = await sql`
      SELECT user_id FROM devices WHERE device_id = ${deviceId}
    `;
    if (device[0]?.user_id) {
      userId = device[0].user_id;
    }
  }
  
  // Check if device exists, if not create it (for web users)
  const existingDevice = await sql`
    SELECT id FROM devices WHERE device_id = ${deviceId}
  `;
  
  if (existingDevice.length === 0) {
    // Device doesn't exist, create it with placeholder token
    // This is for web users who don't have push tokens
    const platform = deviceId.startsWith('web-') ? 'web' : 'unknown';
    await sql`
      INSERT INTO devices (device_id, expo_push_token, platform, user_id, is_active)
      VALUES (${deviceId}, ${'web-placeholder-token'}, ${platform}, ${userId}, true)
      ON CONFLICT (device_id) DO NOTHING
    `;
    console.log(`[createPriceAlert] Created device record for ${deviceId} (web user)`);
  }
  
  const result = await sql`
    INSERT INTO price_alerts (device_id, user_id, symbol, target_price, proximity_delta, direction)
    VALUES (${deviceId}, ${userId}, ${symbol.toUpperCase()}, ${targetPrice}, ${proximityDelta}, ${direction})
    RETURNING *
  `;
  return result[0];
}

export async function getPriceAlerts(deviceId, userId = null) {
  const sql = getSql();
  
  // If userId provided, filter by both deviceId and userId
  if (userId) {
    return await sql`
      SELECT * FROM price_alerts
      WHERE device_id = ${deviceId} 
        AND user_id = ${userId}
        AND is_active = true
      ORDER BY created_at DESC
    `;
  }
  
  return await sql`
    SELECT * FROM price_alerts
    WHERE device_id = ${deviceId} AND is_active = true
    ORDER BY created_at DESC
  `;
}

export async function getActivePriceAlertsBySymbol(symbol) {
  const sql = getSql();
  
  // Only return alerts for premium/trial users
  return await sql`
    SELECT 
      pa.*, 
      d.expo_push_token, 
      d.platform,
      d.user_id,
      u.plan,
      u.expiry_date,
      u.trial_started_at,
      u.trial_ended_at
    FROM price_alerts pa
    JOIN devices d ON pa.device_id = d.device_id
    LEFT JOIN users u ON d.user_id = u.id
    WHERE pa.symbol = ${symbol.toUpperCase()}
      AND pa.is_active = true
      AND d.is_active = true
      AND d.user_id IS NOT NULL
      AND (
        -- Premium users (with or without expiry)
        (u.plan = 'premium' AND (u.expiry_date IS NULL OR u.expiry_date > CURRENT_TIMESTAMP))
        OR
        -- Trial users (active trial)
        (
          u.plan = 'free' 
          AND u.trial_started_at IS NOT NULL
          AND u.trial_started_at <= CURRENT_TIMESTAMP
          AND (
            -- Trial ended_at yoksa, 3 gün hesapla
            (u.trial_ended_at IS NULL AND (u.trial_started_at + INTERVAL '3 days') > CURRENT_TIMESTAMP)
            OR
            -- Trial ended_at varsa, kontrol et
            (u.trial_ended_at IS NOT NULL AND u.trial_ended_at > CURRENT_TIMESTAMP)
          )
        )
      )
  `;
}

/**
 * Get all active custom price alerts (for all symbols)
 * Used to discover which symbols need WebSocket connections
 */
export async function getAllActiveCustomAlerts() {
  const sql = getSql();
  
  // Only return alerts for premium/trial users
  return await sql`
    SELECT 
      pa.*, 
      d.expo_push_token, 
      d.platform,
      d.user_id,
      u.plan,
      u.expiry_date,
      u.trial_started_at,
      u.trial_ended_at
    FROM price_alerts pa
    JOIN devices d ON pa.device_id = d.device_id
    LEFT JOIN users u ON d.user_id = u.id
    WHERE pa.is_active = true
      AND d.is_active = true
      AND d.user_id IS NOT NULL
      AND (
        -- Premium users (with or without expiry)
        (u.plan = 'premium' AND (u.expiry_date IS NULL OR u.expiry_date > CURRENT_TIMESTAMP))
        OR
        -- Trial users (active trial)
        (
          u.plan = 'free' 
          AND u.trial_started_at IS NOT NULL
          AND u.trial_started_at <= CURRENT_TIMESTAMP
          AND (
            -- Trial ended_at yoksa, 3 gün hesapla
            (u.trial_ended_at IS NULL AND (u.trial_started_at + INTERVAL '3 days') > CURRENT_TIMESTAMP)
            OR
            -- Trial ended_at varsa, kontrol et
            (u.trial_ended_at IS NOT NULL AND u.trial_ended_at > CURRENT_TIMESTAMP)
          )
        )
      )
    ORDER BY pa.symbol, pa.created_at
  `;
}

export async function updatePriceAlertNotification(id, lastPrice) {
  const sql = getSql();
  await sql`
    UPDATE price_alerts
    SET last_notified_at = CURRENT_TIMESTAMP,
        last_price = ${lastPrice},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
  `;
}

export async function deletePriceAlert(id, deviceId) {
  const sql = getSql();
  await sql`
    DELETE FROM price_alerts
    WHERE id = ${id} AND device_id = ${deviceId}
  `;
}

// Alarm subscription operations
export async function createAlarmSubscription(deviceId, alarmKey, symbol) {
  const sql = getSql();
  const result = await sql`
    INSERT INTO alarm_subscriptions (device_id, alarm_key, symbol)
    VALUES (${deviceId}, ${alarmKey}, ${symbol || null})
    ON CONFLICT (device_id, alarm_key)
    DO UPDATE SET
      is_active = true,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;
  return result[0];
}

export async function getAlarmSubscriptionsByKey(alarmKey) {
  const sql = getSql();
  return await sql`
    SELECT asub.*, d.expo_push_token, d.platform
    FROM alarm_subscriptions asub
    JOIN devices d ON asub.device_id = d.device_id
    WHERE asub.alarm_key = ${alarmKey}
      AND asub.is_active = true
      AND d.is_active = true
  `;
}

export async function updateAlarmSubscriptionNotification(id) {
  const sql = getSql();
  await sql`
    UPDATE alarm_subscriptions
    SET last_notified_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
  `;
}

export async function deleteAlarmSubscription(deviceId, alarmKey) {
  const sql = getSql();
  await sql`
    DELETE FROM alarm_subscriptions
    WHERE device_id = ${deviceId} AND alarm_key = ${alarmKey}
  `;
}
