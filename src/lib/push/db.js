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
    await sql`CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol ON price_alerts(symbol)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active)`;
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
  const result = await sql`
    INSERT INTO devices (device_id, expo_push_token, platform, app_version, user_id, model, os_version, updated_at)
    VALUES (${deviceId}, ${expoPushToken}, ${platform}, ${appVersion}, ${userId}, ${model}, ${osVersion}, CURRENT_TIMESTAMP)
    ON CONFLICT (device_id)
    DO UPDATE SET
      expo_push_token = ${expoPushToken},
      platform = ${platform},
      app_version = ${appVersion},
      user_id = COALESCE(${userId}, devices.user_id),
      model = ${model},
      os_version = ${osVersion},
      is_active = true,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;
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

export async function getAllActiveDevices() {
  const sql = getSql();
  return await sql`
    SELECT * FROM devices
    WHERE is_active = true
  `;
}

// Price alert operations
export async function createPriceAlert(deviceId, symbol, targetPrice, proximityDelta, direction) {
  const sql = getSql();
  const result = await sql`
    INSERT INTO price_alerts (device_id, symbol, target_price, proximity_delta, direction)
    VALUES (${deviceId}, ${symbol.toUpperCase()}, ${targetPrice}, ${proximityDelta}, ${direction})
    RETURNING *
  `;
  return result[0];
}

export async function getPriceAlerts(deviceId) {
  const sql = getSql();
  return await sql`
    SELECT * FROM price_alerts
    WHERE device_id = ${deviceId} AND is_active = true
    ORDER BY created_at DESC
  `;
}

export async function getActivePriceAlertsBySymbol(symbol) {
  const sql = getSql();
  return await sql`
    SELECT pa.*, d.expo_push_token, d.platform
    FROM price_alerts pa
    JOIN devices d ON pa.device_id = d.device_id
    WHERE pa.symbol = ${symbol.toUpperCase()}
      AND pa.is_active = true
      AND d.is_active = true
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
