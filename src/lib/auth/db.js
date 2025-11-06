/**
 * Authentication database operations (Neon PostgreSQL)
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
 * Initialize authentication database tables
 */
export async function initAuthDatabase() {
  const sql = getSql();
  try {
    // Users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `;

    // User sessions table
    await sql`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        refresh_token VARCHAR(500) UNIQUE NOT NULL,
        device_id VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `;

    // Alarms table
    await sql`
      CREATE TABLE IF NOT EXISTS alarms (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        alarm_key VARCHAR(255) NOT NULL,
        exchange VARCHAR(50) NOT NULL,
        pair VARCHAR(50) NOT NULL,
        price DECIMAL(20, 8) NOT NULL,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('above', 'below')),
        is_triggered BOOLEAN DEFAULT false,
        triggered_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, alarm_key)
      )
    `;

    // Add user_id columns to existing tables if they don't exist
    try {
      await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS user_id INTEGER`;
      await sql`ALTER TABLE devices ADD CONSTRAINT IF NOT EXISTS fk_devices_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`;
    } catch (e) {
      // Column might already exist, ignore
      console.log('Note: devices.user_id column might already exist');
    }

    try {
      await sql`ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS user_id INTEGER`;
      await sql`ALTER TABLE price_alerts ADD CONSTRAINT IF NOT EXISTS fk_price_alerts_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`;
    } catch (e) {
      console.log('Note: price_alerts.user_id column might already exist');
    }

    try {
      await sql`ALTER TABLE alarm_subscriptions ADD COLUMN IF NOT EXISTS user_id INTEGER`;
      await sql`ALTER TABLE alarm_subscriptions ADD CONSTRAINT IF NOT EXISTS fk_alarm_subscriptions_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`;
    } catch (e) {
      console.log('Note: alarm_subscriptions.user_id column might already exist');
    }

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token ON user_sessions(refresh_token)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_price_alerts_user_id ON price_alerts(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_alarm_subscriptions_user_id ON alarm_subscriptions(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_alarms_user_id ON alarms(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_alarms_alarm_key ON alarms(alarm_key)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_alarms_triggered ON alarms(is_triggered)`;

    console.log('✅ Authentication database initialized');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize auth database:', error);
    throw error;
  }
}

// User operations
export async function createUser(email, passwordHash, name = null) {
  const sql = getSql();
  const result = await sql`
    INSERT INTO users (email, password_hash, name)
    VALUES (${email}, ${passwordHash}, ${name})
    RETURNING id, email, name, created_at
  `;
  return result[0];
}

export async function getUserByEmail(email) {
  const sql = getSql();
  const result = await sql`
    SELECT * FROM users
    WHERE email = ${email} AND is_active = true
  `;
  return result[0];
}

export async function getUserById(userId) {
  const sql = getSql();
  const result = await sql`
    SELECT id, email, name, created_at, last_login_at, is_active
    FROM users
    WHERE id = ${userId} AND is_active = true
  `;
  return result[0];
}

export async function updateUserLastLogin(userId) {
  const sql = getSql();
  await sql`
    UPDATE users
    SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${userId}
  `;
}

// Session operations
export async function createSession(userId, refreshToken, deviceId = null, ipAddress = null, userAgent = null, expiresAt) {
  const sql = getSql();
  const result = await sql`
    INSERT INTO user_sessions (user_id, refresh_token, device_id, ip_address, user_agent, expires_at)
    VALUES (${userId}, ${refreshToken}, ${deviceId}, ${ipAddress}, ${userAgent}, ${expiresAt})
    RETURNING *
  `;
  return result[0];
}

export async function getSessionByRefreshToken(refreshToken) {
  const sql = getSql();
  const result = await sql`
    SELECT s.*, u.email, u.name
    FROM user_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.refresh_token = ${refreshToken}
      AND s.expires_at > CURRENT_TIMESTAMP
      AND u.is_active = true
  `;
  return result[0];
}

export async function deleteSession(refreshToken) {
  const sql = getSql();
  await sql`
    DELETE FROM user_sessions
    WHERE refresh_token = ${refreshToken}
  `;
}

export async function deleteUserSessions(userId) {
  const sql = getSql();
  await sql`
    DELETE FROM user_sessions
    WHERE user_id = ${userId}
  `;
}

export async function cleanupExpiredSessions() {
  const sql = getSql();
  const result = await sql`
    DELETE FROM user_sessions
    WHERE expires_at < CURRENT_TIMESTAMP
    RETURNING id
  `;
  return result.length;
}

// Alarm operations
export async function createAlarm(userId, alarmKey, exchange, pair, price, direction) {
  const sql = getSql();
  const result = await sql`
    INSERT INTO alarms (user_id, alarm_key, exchange, pair, price, direction)
    VALUES (${userId}, ${alarmKey}, ${exchange}, ${pair}, ${price}, ${direction})
    ON CONFLICT (user_id, alarm_key)
    DO UPDATE SET
      exchange = ${exchange},
      pair = ${pair},
      price = ${price},
      direction = ${direction},
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;
  return result[0];
}

export async function getUserAlarms(userId) {
  const sql = getSql();
  return await sql`
    SELECT * FROM alarms
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
}

export async function getAlarmByKey(userId, alarmKey) {
  const sql = getSql();
  const result = await sql`
    SELECT * FROM alarms
    WHERE user_id = ${userId} AND alarm_key = ${alarmKey}
  `;
  return result[0];
}

export async function deleteAlarm(userId, alarmKey) {
  const sql = getSql();
  await sql`
    DELETE FROM alarms
    WHERE user_id = ${userId} AND alarm_key = ${alarmKey}
  `;
}

export async function markAlarmTriggered(userId, alarmKey) {
  const sql = getSql();
  await sql`
    UPDATE alarms
    SET is_triggered = true,
        triggered_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ${userId} AND alarm_key = ${alarmKey}
  `;
}

// Get user devices
export async function getUserDevices(userId) {
  const sql = getSql();
  return await sql`
    SELECT * FROM devices
    WHERE user_id = ${userId} AND is_active = true
  `;
}


