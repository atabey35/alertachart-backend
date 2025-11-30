/**
 * Authentication database operations (Railway PostgreSQL)
 */

import postgres from 'postgres';

let sql = null;

export function getSql() {
  if (!sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    // Railway PostgreSQL connection
    sql = postgres(process.env.DATABASE_URL, {
      max: 1, // Connection pool size
      idle_timeout: 20,
      connect_timeout: 10,
    });
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
      
      // Check if constraint exists before adding (PostgreSQL doesn't support IF NOT EXISTS for constraints)
      const constraintExists = await sql`
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_devices_user_id' 
        LIMIT 1
      `;
      if (constraintExists.length === 0) {
        await sql`ALTER TABLE devices ADD CONSTRAINT fk_devices_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`;
        console.log('✅ Added fk_devices_user_id constraint');
      }
    } catch (e) {
      // Column or constraint might already exist, ignore
      console.log('Note: devices.user_id column/constraint might already exist');
    }

    try {
      await sql`ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS user_id INTEGER`;
      
      const constraintExists = await sql`
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_price_alerts_user_id' 
        LIMIT 1
      `;
      if (constraintExists.length === 0) {
        await sql`ALTER TABLE price_alerts ADD CONSTRAINT fk_price_alerts_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`;
        console.log('✅ Added fk_price_alerts_user_id constraint');
      }
    } catch (e) {
      console.log('Note: price_alerts.user_id column/constraint might already exist');
    }

    try {
      await sql`ALTER TABLE alarm_subscriptions ADD COLUMN IF NOT EXISTS user_id INTEGER`;
      
      const constraintExists = await sql`
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_alarm_subscriptions_user_id' 
        LIMIT 1
      `;
      if (constraintExists.length === 0) {
        await sql`ALTER TABLE alarm_subscriptions ADD CONSTRAINT fk_alarm_subscriptions_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`;
        console.log('✅ Added fk_alarm_subscriptions_user_id constraint');
      }
    } catch (e) {
      console.log('Note: alarm_subscriptions.user_id column/constraint might already exist');
    }

    // Migration: Recreate device_id column with UNIQUE constraint
    // This ensures each device_id can only belong to one user
    try {
      // Check if device_id column exists
      const columnExists = await sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
          AND column_name = 'device_id'
      `;
      
      if (columnExists.length > 0) {
        console.log('🔄 Dropping existing device_id column...');
        // Drop the column (this will fail if there are constraints, so we handle it)
        try {
          await sql`ALTER TABLE users DROP COLUMN device_id`;
          console.log('✅ device_id column dropped');
        } catch (dropError: any) {
          // If column has constraints, drop them first
          if (dropError.message?.includes('constraint') || dropError.code === '2BP01') {
            console.log('⚠️ device_id has constraints, dropping them first...');
            // Try to drop unique constraint if exists
            try {
              await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_device_id_key`;
            } catch (e) {
              // Ignore if constraint doesn't exist
            }
            // Try again
            await sql`ALTER TABLE users DROP COLUMN device_id`;
            console.log('✅ device_id column dropped after removing constraints');
          } else {
            throw dropError;
          }
        }
      }
      
      // Create device_id column with UNIQUE constraint
      console.log('🔄 Creating device_id column with UNIQUE constraint...');
      await sql`ALTER TABLE users ADD COLUMN device_id TEXT UNIQUE`;
      console.log('✅ device_id column created with UNIQUE constraint');
    } catch (migrationError: any) {
      // Column might already exist with different structure, or error occurred
      console.error('❌ device_id column migration error:', migrationError.message);
      // Try to add unique constraint if column exists but doesn't have it
      try {
        const hasUnique = await sql`
          SELECT constraint_name 
          FROM information_schema.table_constraints 
          WHERE table_name = 'users' 
            AND constraint_type = 'UNIQUE' 
            AND constraint_name LIKE '%device_id%'
        `;
        if (hasUnique.length === 0) {
          console.log('🔄 Adding UNIQUE constraint to existing device_id column...');
          await sql`ALTER TABLE users ADD CONSTRAINT users_device_id_unique UNIQUE (device_id)`;
          console.log('✅ UNIQUE constraint added to device_id');
        } else {
          console.log('✅ device_id already has UNIQUE constraint');
        }
      } catch (constraintError: any) {
        console.warn('⚠️ Could not add UNIQUE constraint:', constraintError.message);
        // Continue anyway - column exists, just without unique constraint
      }
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
export async function createUser(email, passwordHash, name = null, provider = null, providerUserId = null, deviceId = null) {
  const sql = getSql();
  const result = await sql`
    INSERT INTO users (email, password_hash, name, provider, provider_user_id, device_id)
    VALUES (${email}, ${passwordHash}, ${name}, ${provider}, ${providerUserId}, ${deviceId})
    RETURNING id, email, name, provider, provider_user_id, device_id, created_at
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
    SELECT id, email, name, provider, provider_user_id, plan, expiry_date, trial_started_at, trial_ended_at, subscription_started_at, created_at, last_login_at, is_active
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


