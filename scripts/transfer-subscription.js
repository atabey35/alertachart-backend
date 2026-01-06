/**
 * Transfer Subscription Script
 * Transfers subscription data from one user to another
 * 
 * Usage: node scripts/transfer-subscription.js
 * 
 * Source: ID 2550 (b.sen40@yahoo.com)
 * Target: 4141009@gmail.com
 * 
 * Transfers: plan, expiry_date, subscription_started_at
 * After transfer: Source user becomes 'free' with null subscription fields
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

// ===== CONFIGURATION =====
const SOURCE_USER_ID = 2550;
const SOURCE_EMAIL = 'b.sen40@yahoo.com';
const TARGET_EMAIL = '4141009@gmail.com';
// =========================

async function transferSubscription() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 SUBSCRIPTION TRANSFER SCRIPT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📤 Source: ID ${SOURCE_USER_ID} (${SOURCE_EMAIL})`);
    console.log(`📥 Target: ${TARGET_EMAIL}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
        // Step 1: Verify source user
        console.log('📋 Step 1: Verifying source user...');
        const sourceUsers = await sql`
      SELECT id, email, plan, expiry_date, subscription_started_at, trial_started_at, trial_ended_at
      FROM users
      WHERE id = ${SOURCE_USER_ID} AND is_active = true
    `;

        if (sourceUsers.length === 0) {
            console.log(`❌ Source user with ID ${SOURCE_USER_ID} not found!`);
            return;
        }

        const sourceUser = sourceUsers[0];

        // Verify email matches
        if (sourceUser.email !== SOURCE_EMAIL) {
            console.log(`❌ Email mismatch! Expected: ${SOURCE_EMAIL}, Found: ${sourceUser.email}`);
            console.log('⚠️  Aborting for safety.');
            return;
        }

        console.log('✅ Source user verified:');
        console.log(`   ID: ${sourceUser.id}`);
        console.log(`   Email: ${sourceUser.email}`);
        console.log(`   Plan: ${sourceUser.plan}`);
        console.log(`   Expiry Date: ${sourceUser.expiry_date || 'NULL (lifetime)'}`);
        console.log(`   Subscription Started: ${sourceUser.subscription_started_at || 'NULL'}`);
        console.log('');

        // Step 2: Verify target user
        console.log('📋 Step 2: Verifying target user...');
        const targetUsers = await sql`
      SELECT id, email, plan, expiry_date, subscription_started_at, trial_started_at, trial_ended_at
      FROM users
      WHERE email = ${TARGET_EMAIL} AND is_active = true
    `;

        if (targetUsers.length === 0) {
            console.log(`❌ Target user with email ${TARGET_EMAIL} not found!`);
            return;
        }

        const targetUser = targetUsers[0];
        console.log('✅ Target user verified:');
        console.log(`   ID: ${targetUser.id}`);
        console.log(`   Email: ${targetUser.email}`);
        console.log(`   Current Plan: ${targetUser.plan}`);
        console.log(`   Current Expiry: ${targetUser.expiry_date || 'NULL'}`);
        console.log(`   Current Sub Started: ${targetUser.subscription_started_at || 'NULL'}`);
        console.log('');

        // Step 3: Show what will be transferred
        console.log('📋 Step 3: Transfer Summary');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Fields to transfer:');
        console.log(`   plan: ${sourceUser.plan} → ${targetUser.email}`);
        console.log(`   expiry_date: ${sourceUser.expiry_date || 'NULL'} → ${targetUser.email}`);
        console.log(`   subscription_started_at: ${sourceUser.subscription_started_at || 'NULL'} → ${targetUser.email}`);
        console.log('');
        console.log('Source user will become:');
        console.log('   plan: free');
        console.log('   expiry_date: NULL');
        console.log('   subscription_started_at: NULL');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Step 4: Execute transfer in a transaction
        console.log('📋 Step 4: Executing transfer...');

        await sql.begin(async (sql) => {
            // Update target user with source subscription
            await sql`
        UPDATE users
        SET 
          plan = ${sourceUser.plan},
          expiry_date = ${sourceUser.expiry_date},
          subscription_started_at = ${sourceUser.subscription_started_at},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${targetUser.id}
      `;
            console.log(`   ✅ Target user (${targetUser.email}) updated with subscription`);

            // Reset source user to free
            await sql`
        UPDATE users
        SET 
          plan = 'free',
          expiry_date = NULL,
          subscription_started_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${sourceUser.id}
      `;
            console.log(`   ✅ Source user (${sourceUser.email}) reset to free`);
        });

        console.log('\n✅ TRANSFER COMPLETED SUCCESSFULLY!\n');

        // Step 5: Verify changes
        console.log('📋 Step 5: Verifying changes...');

        const updatedSource = await sql`
      SELECT id, email, plan, expiry_date, subscription_started_at
      FROM users WHERE id = ${sourceUser.id}
    `;

        const updatedTarget = await sql`
      SELECT id, email, plan, expiry_date, subscription_started_at
      FROM users WHERE id = ${targetUser.id}
    `;

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 FINAL STATE');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        console.log(`\n📤 Source User (${updatedSource[0].email}):`);
        console.log(`   Plan: ${updatedSource[0].plan}`);
        console.log(`   Expiry Date: ${updatedSource[0].expiry_date || 'NULL'}`);
        console.log(`   Subscription Started: ${updatedSource[0].subscription_started_at || 'NULL'}`);

        console.log(`\n📥 Target User (${updatedTarget[0].email}):`);
        console.log(`   Plan: ${updatedTarget[0].plan}`);
        console.log(`   Expiry Date: ${updatedTarget[0].expiry_date || 'NULL'}`);
        console.log(`   Subscription Started: ${updatedTarget[0].subscription_started_at || 'NULL'}`);

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎉 Transfer completed successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error('Full error:', error);
    } finally {
        await sql.end();
    }
}

// Run the transfer
transferSubscription();
