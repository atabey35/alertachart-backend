/**
 * Test script to check devices and send push notifications
 */

import dotenv from 'dotenv';
import { getDevice, getAllActiveDevices } from './src/lib/push/db.js';
import { sendTestNotification } from './src/lib/push/expo-push.js';

dotenv.config();

async function testPush() {
  try {
    console.log('🔍 Checking active devices...\n');
    
    const devices = await getAllActiveDevices();
    
    if (!devices || devices.length === 0) {
      console.log('❌ No active devices found');
      console.log('\n📱 Please:');
      console.log('   1. Open the mobile app');
      console.log('   2. Allow push notifications');
      console.log('   3. Wait for device registration');
      console.log('   4. Run this script again\n');
      return;
    }
    
    console.log(`✅ Found ${devices.length} active device(s):\n`);
    
    for (const device of devices) {
      console.log(`📱 Device ID: ${device.device_id}`);
      console.log(`   Platform: ${device.platform || 'unknown'}`);
      console.log(`   Token: ${device.expo_push_token ? device.expo_push_token.substring(0, 30) + '...' : 'NO TOKEN'}`);
      console.log(`   Created: ${device.created_at}`);
      console.log();
      
      if (device.expo_push_token && device.expo_push_token !== 'ExponentPushToken[test-token-1234]') {
        console.log(`🔔 Sending test push to ${device.device_id}...`);
        
        const success = await sendTestNotification(device.expo_push_token);
        
        if (success) {
          console.log(`✅ Test notification sent successfully!\n`);
        } else {
          console.log(`❌ Failed to send notification\n`);
        }
      } else {
        console.log(`⚠️  No valid push token - device needs to complete registration\n`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  }
}

// Run test
testPush().then(() => {
  console.log('\n✅ Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});


