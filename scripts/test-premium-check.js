/**
 * Test Premium Check for a specific user
 * Usage: node scripts/test-premium-check.js <email>
 */

import postgres from 'postgres';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file
dotenv.config({ path: join(__dirname, '../.env') });

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

async function testPremiumCheck(email) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔍 Testing Premium Check for: ${email}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Get user from database
    const users = await sql`
      SELECT id, email, name, plan, expiry_date, trial_started_at, trial_ended_at, subscription_started_at
      FROM users
      WHERE email = ${email} AND is_active = true
      LIMIT 1
    `;

    if (users.length === 0) {
      console.log('❌ User not found');
      return;
    }

    const user = users[0];
    console.log('📋 User Data:');
    console.log(JSON.stringify(user, null, 2));
    console.log('');

    // Get user's devices (both linked and unlinked)
    const devices = await sql`
      SELECT device_id, platform, user_id, is_active, expo_push_token, created_at, updated_at
      FROM devices
      WHERE user_id = ${user.id} AND is_active = true
    `;
    
    // Also check for devices that might not be linked yet (by device_id pattern or recent creation)
    const allDevices = await sql`
      SELECT device_id, platform, user_id, is_active, expo_push_token, created_at, updated_at
      FROM devices
      WHERE is_active = true
      ORDER BY created_at DESC
      LIMIT 10
    `;
    
    console.log(`\n📱 All Recent Devices (last 10):`);
    allDevices.forEach((device, index) => {
      const isLinked = device.user_id === user.id;
      const tokenPreview = device.expo_push_token ? `${device.expo_push_token.substring(0, 30)}...` : 'NO TOKEN';
      console.log(`  ${index + 1}. ${device.device_id} (${device.platform}) - user_id: ${device.user_id || 'NULL'} ${isLinked ? '✅ LINKED' : '❌ NOT LINKED'} - token: ${tokenPreview}`);
    });

    console.log(`📱 Devices (${devices.length}):`);
    devices.forEach((device, index) => {
      console.log(`  ${index + 1}. ${device.device_id} (${device.platform}) - user_id: ${device.user_id || 'NULL'}`);
    });
    console.log('');

    // Premium check logic (same as backend)
    let isPremium = false;
    if (user.plan === 'premium') {
      if (user.expiry_date) {
        const expiry = new Date(user.expiry_date);
        const now = new Date();
        isPremium = expiry > now;
        console.log(`💎 Premium Check:`);
        console.log(`   Plan: ${user.plan}`);
        console.log(`   Expiry Date: ${user.expiry_date} (${expiry.toISOString()})`);
        console.log(`   Now: ${now.toISOString()}`);
        console.log(`   Expiry > Now: ${expiry > now}`);
        console.log(`   isPremium: ${isPremium}`);
      } else {
        isPremium = true;
        console.log(`💎 Premium Check:`);
        console.log(`   Plan: ${user.plan}`);
        console.log(`   Expiry Date: NULL (lifetime premium)`);
        console.log(`   isPremium: ${isPremium}`);
      }
    } else {
      console.log(`💎 Premium Check:`);
      console.log(`   Plan: ${user.plan} (not premium)`);
      console.log(`   isPremium: ${isPremium}`);
    }

    // Trial check
    let isTrial = false;
    if (user.plan === 'free' && user.trial_started_at) {
      const trialStart = new Date(user.trial_started_at);
      let trialEnd;
      
      if (user.trial_ended_at) {
        trialEnd = new Date(user.trial_ended_at);
      } else {
        trialEnd = new Date(trialStart);
        trialEnd.setDate(trialEnd.getDate() + 3);
      }
      
      const now = new Date();
      isTrial = now >= trialStart && now < trialEnd;
      
      console.log(`\n🎁 Trial Check:`);
      console.log(`   Trial Start: ${user.trial_started_at} (${trialStart.toISOString()})`);
      console.log(`   Trial End: ${user.trial_ended_at || 'calculated'} (${trialEnd.toISOString()})`);
      console.log(`   Now: ${now.toISOString()}`);
      console.log(`   Now >= Start: ${now >= trialStart}`);
      console.log(`   Now < End: ${now < trialEnd}`);
      console.log(`   isTrial: ${isTrial}`);
    }

    const hasPremiumAccess = isPremium || isTrial;

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 RESULT:');
    console.log(`   hasPremiumAccess: ${hasPremiumAccess ? '✅ YES' : '❌ NO'}`);
    console.log(`   Will receive notifications: ${hasPremiumAccess ? '✅ YES' : '❌ NO'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check device linking
    if (devices.length > 0) {
      const unlinkedDevices = devices.filter(d => !d.user_id);
      if (unlinkedDevices.length > 0) {
        console.log('⚠️  WARNING: Some devices are not linked to user:');
        unlinkedDevices.forEach(device => {
          console.log(`   - ${device.device_id} (user_id is NULL)`);
        });
        console.log('   💡 These devices will NOT receive notifications!');
        console.log('   💡 User needs to login and link devices via /api/devices/link\n');
      } else {
        console.log('✅ All devices are linked to user\n');
      }
    } else {
      console.log('⚠️  WARNING: No devices found for this user\n');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Get email from command line
const email = process.argv[2];

if (!email) {
  console.log('Usage: node scripts/test-premium-check.js <email>');
  process.exit(1);
}

testPremiumCheck(email).then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

