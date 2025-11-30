/**
 * Test script to check why only 1 premium device is found
 * Run: node scripts/test-premium-devices.js
 */

import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

async function testPremiumDevices() {
  console.log('🔍 Testing premium/trial devices query...\n');

  try {
    // 1. Check all premium users
    console.log('1️⃣ All premium users:');
    const premiumUsers = await sql`
      SELECT id, email, plan, expiry_date, trial_started_at, trial_ended_at, is_active
      FROM users
      WHERE plan = 'premium' AND is_active = true
      ORDER BY id
    `;
    console.log(`Found ${premiumUsers.length} premium users:`);
    premiumUsers.forEach(user => {
      console.log(`  - ID: ${user.id}, Email: ${user.email}, Expiry: ${user.expiry_date || 'LIFETIME'}, Active: ${user.is_active}`);
    });
    console.log('');

    // 2. Check all devices with user_id
    console.log('2️⃣ All devices with user_id:');
    const allDevices = await sql`
      SELECT d.id, d.device_id, d.user_id, d.is_active, u.email, u.plan
      FROM devices d
      LEFT JOIN users u ON d.user_id = u.id
      WHERE d.is_active = true AND d.user_id IS NOT NULL
      ORDER BY d.user_id
    `;
    console.log(`Found ${allDevices.length} active devices with user_id:`);
    allDevices.forEach(device => {
      console.log(`  - Device ID: ${device.device_id}, User ID: ${device.user_id}, Email: ${device.email || 'NO USER'}, Plan: ${device.plan || 'NO PLAN'}`);
    });
    console.log('');

    // 3. Test the actual query
    console.log('3️⃣ Testing getPremiumTrialDevices() query:');
    const now = new Date();
    const premiumDevices = await sql`
      SELECT 
        d.id,
        d.device_id,
        d.expo_push_token,
        d.user_id,
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
          (u.plan = 'premium' AND (u.expiry_date IS NULL OR u.expiry_date > ${now}::timestamp))
          OR
          -- Trial users (active trial)
          (
            u.plan = 'free' 
            AND u.trial_started_at IS NOT NULL
            AND u.trial_started_at <= ${now}::timestamp
            AND (
              -- Trial ended_at yoksa, 3 gün hesapla
              (u.trial_ended_at IS NULL AND (u.trial_started_at + INTERVAL '3 days') > ${now}::timestamp)
              OR
              -- Trial ended_at varsa, kontrol et
              (u.trial_ended_at IS NOT NULL AND u.trial_ended_at > ${now}::timestamp)
            )
          )
        )
      ORDER BY d.user_id, d.id
    `;
    console.log(`Found ${premiumDevices.length} premium/trial devices:`);
    premiumDevices.forEach(device => {
      console.log(`  - Device: ${device.device_id}, User: ${device.email} (${device.user_id}), Plan: ${device.plan}, Expiry: ${device.expiry_date || 'LIFETIME'}`);
    });
    console.log('');

    // 4. Check why other premium users are not included
    console.log('4️⃣ Checking why other premium users are excluded:');
    for (const user of premiumUsers) {
      const userDevices = await sql`
        SELECT d.id, d.device_id, d.is_active, d.user_id
        FROM devices d
        WHERE d.user_id = ${user.id} AND d.is_active = true
      `;
      
      if (userDevices.length === 0) {
        console.log(`  ⚠️  ${user.email} (ID: ${user.id}): NO ACTIVE DEVICES`);
      } else {
        const isIncluded = premiumDevices.some(d => d.user_id === user.id);
        if (!isIncluded) {
          console.log(`  ❌ ${user.email} (ID: ${user.id}): HAS ${userDevices.length} DEVICE(S) BUT NOT IN QUERY`);
          console.log(`     - Expiry date: ${user.expiry_date || 'NULL (LIFETIME)'}`);
          if (user.expiry_date) {
            const expiry = new Date(user.expiry_date);
            const isExpired = expiry <= now;
            console.log(`     - Is expired: ${isExpired} (${expiry.toISOString()} vs ${now.toISOString()})`);
          }
        } else {
          console.log(`  ✅ ${user.email} (ID: ${user.id}): INCLUDED (${userDevices.length} device(s))`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
  }
}

testPremiumDevices();

