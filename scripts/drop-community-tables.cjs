/**
 * Drop Community Tables Migration
 * Run once to remove unused community feature tables
 */

const postgres = require('postgres');

async function dropCommunityTables() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
        console.error('❌ DATABASE_URL not set');
        process.exit(1);
    }

    const sql = postgres(databaseUrl, {
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('🗑️ Dropping community tables...');

        // Drop in order to respect foreign key constraints
        // (children first, then parents)

        await sql`DROP TABLE IF EXISTS community_likes CASCADE`;
        console.log('  ✅ Dropped community_likes');

        await sql`DROP TABLE IF EXISTS community_comments CASCADE`;
        console.log('  ✅ Dropped community_comments');

        await sql`DROP TABLE IF EXISTS community_analyses CASCADE`;
        console.log('  ✅ Dropped community_analyses');

        await sql`DROP TABLE IF EXISTS community_posts CASCADE`;
        console.log('  ✅ Dropped community_posts');

        await sql`DROP TABLE IF EXISTS community_users CASCADE`;
        console.log('  ✅ Dropped community_users');

        console.log('\n✅ All community tables dropped successfully!');

        await sql.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error dropping tables:', error);
        await sql.end();
        process.exit(1);
    }
}

dropCommunityTables();
