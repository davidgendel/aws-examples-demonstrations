#!/usr/bin/env node

/**
 * Database Cleanup Script
 * 
 * This script performs database maintenance tasks including:
 * - Cleaning up old document chunks
 * - Removing orphaned documents
 * - Cleaning processing logs
 * - Optimizing database performance
 */

const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Configuration
const CONFIG = {
  region: process.env.AWS_REGION || process.env.REGION || 'us-east-1',
  dbSecretArn: process.env.DB_SECRET_ARN,
  dryRun: process.argv.includes('--dry-run'),
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v')
};

// Initialize AWS clients
const secretsManagerClient = new SecretsManagerClient({ region: CONFIG.region });

// Logging utilities
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = CONFIG.verbose ? `[${timestamp}] [${level.toUpperCase()}]` : `[${level.toUpperCase()}]`;
  console.log(`${prefix} ${message}`);
}

function verbose(message) {
  if (CONFIG.verbose) {
    log(message, 'verbose');
  }
}

// Get database credentials from Secrets Manager
async function getDbCredentials() {
  if (!CONFIG.dbSecretArn) {
    throw new Error('DB_SECRET_ARN environment variable is required');
  }
  
  const command = new GetSecretValueCommand({ SecretId: CONFIG.dbSecretArn });
  
  try {
    const data = await secretsManagerClient.send(command);
    return JSON.parse(data.SecretString);
  } catch (error) {
    throw new Error(`Failed to retrieve database credentials: ${error.message}`);
  }
}

// Create database connection
async function createDbConnection() {
  const credentials = await getDbCredentials();
  
  const client = new Client({
    host: credentials.host,
    port: credentials.port || 5432,
    database: credentials.dbname,
    username: credentials.username,
    password: credentials.password,
    ssl: { rejectUnauthorized: false }
  });
  
  await client.connect();
  verbose('Database connection established');
  
  return client;
}

// Cleanup functions
async function cleanupOldDocumentChunks(client, daysOld = 90) {
  const query = `
    DELETE FROM document_chunks 
    WHERE created_at < NOW() - INTERVAL '${daysOld} days'
  `;
  
  if (CONFIG.dryRun) {
    const countQuery = `
      SELECT COUNT(*) as count 
      FROM document_chunks 
      WHERE created_at < NOW() - INTERVAL '${daysOld} days'
    `;
    const result = await client.query(countQuery);
    log(`[DRY RUN] Would delete ${result.rows[0].count} old document chunks (older than ${daysOld} days)`);
    return { rowCount: parseInt(result.rows[0].count) };
  } else {
    const result = await client.query(query);
    log(`Deleted ${result.rowCount} old document chunks (older than ${daysOld} days)`);
    return result;
  }
}

async function cleanupOrphanedDocuments(client, daysOld = 7) {
  const query = `
    DELETE FROM documents 
    WHERE id NOT IN (SELECT DISTINCT document_id FROM document_chunks WHERE document_id IS NOT NULL)
    AND created_at < NOW() - INTERVAL '${daysOld} days'
  `;
  
  if (CONFIG.dryRun) {
    const countQuery = `
      SELECT COUNT(*) as count 
      FROM documents 
      WHERE id NOT IN (SELECT DISTINCT document_id FROM document_chunks WHERE document_id IS NOT NULL)
      AND created_at < NOW() - INTERVAL '${daysOld} days'
    `;
    const result = await client.query(countQuery);
    log(`[DRY RUN] Would delete ${result.rows[0].count} orphaned documents (older than ${daysOld} days)`);
    return { rowCount: parseInt(result.rows[0].count) };
  } else {
    const result = await client.query(query);
    log(`Deleted ${result.rowCount} orphaned documents (older than ${daysOld} days)`);
    return result;
  }
}

async function cleanupProcessingLogs(client, daysOld = 30) {
  // Check if processing_logs table exists
  const tableExists = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'processing_logs'
    )
  `);
  
  if (!tableExists.rows[0].exists) {
    verbose('Processing logs table does not exist, skipping cleanup');
    return { rowCount: 0 };
  }
  
  const query = `
    DELETE FROM processing_logs 
    WHERE created_at < NOW() - INTERVAL '${daysOld} days'
  `;
  
  if (CONFIG.dryRun) {
    const countQuery = `
      SELECT COUNT(*) as count 
      FROM processing_logs 
      WHERE created_at < NOW() - INTERVAL '${daysOld} days'
    `;
    const result = await client.query(countQuery);
    log(`[DRY RUN] Would delete ${result.rows[0].count} old processing logs (older than ${daysOld} days)`);
    return { rowCount: parseInt(result.rows[0].count) };
  } else {
    const result = await client.query(query);
    log(`Deleted ${result.rowCount} old processing logs (older than ${daysOld} days)`);
    return result;
  }
}

async function optimizeDatabase(client) {
  const tables = ['documents', 'document_chunks', 'processing_logs'];
  
  for (const table of tables) {
    // Check if table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = '${table}'
      )
    `);
    
    if (!tableExists.rows[0].exists) {
      verbose(`Table ${table} does not exist, skipping optimization`);
      continue;
    }
    
    if (CONFIG.dryRun) {
      log(`[DRY RUN] Would run VACUUM ANALYZE on table: ${table}`);
    } else {
      try {
        await client.query(`VACUUM ANALYZE ${table}`);
        verbose(`Optimized table: ${table}`);
      } catch (error) {
        log(`Warning: Failed to optimize table ${table}: ${error.message}`, 'warn');
      }
    }
  }
  
  if (!CONFIG.dryRun) {
    log('Database optimization completed');
  }
}

// Get database statistics
async function getDatabaseStats(client) {
  const stats = {};
  
  // Document chunks count
  try {
    const chunksResult = await client.query('SELECT COUNT(*) as count FROM document_chunks');
    stats.documentChunks = parseInt(chunksResult.rows[0].count);
  } catch (error) {
    stats.documentChunks = 'N/A';
  }
  
  // Documents count
  try {
    const docsResult = await client.query('SELECT COUNT(*) as count FROM documents');
    stats.documents = parseInt(docsResult.rows[0].count);
  } catch (error) {
    stats.documents = 'N/A';
  }
  
  // Processing logs count
  try {
    const logsResult = await client.query('SELECT COUNT(*) as count FROM processing_logs');
    stats.processingLogs = parseInt(logsResult.rows[0].count);
  } catch (error) {
    stats.processingLogs = 'N/A';
  }
  
  // Database size
  try {
    const sizeResult = await client.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);
    stats.databaseSize = sizeResult.rows[0].size;
  } catch (error) {
    stats.databaseSize = 'N/A';
  }
  
  return stats;
}

// Main cleanup function
async function runCleanup() {
  let client;
  
  try {
    log('Starting database cleanup...');
    
    if (CONFIG.dryRun) {
      log('Running in DRY RUN mode - no changes will be made');
    }
    
    client = await createDbConnection();
    
    // Get initial stats
    const initialStats = await getDatabaseStats(client);
    log('Initial database statistics:');
    log(`  Documents: ${initialStats.documents}`);
    log(`  Document chunks: ${initialStats.documentChunks}`);
    log(`  Processing logs: ${initialStats.processingLogs}`);
    log(`  Database size: ${initialStats.databaseSize}`);
    
    // Perform cleanup operations
    const results = {
      chunksDeleted: 0,
      documentsDeleted: 0,
      logsDeleted: 0
    };
    
    // Clean up old document chunks (90 days)
    const chunksResult = await cleanupOldDocumentChunks(client, 90);
    results.chunksDeleted = chunksResult.rowCount;
    
    // Clean up orphaned documents (7 days)
    const docsResult = await cleanupOrphanedDocuments(client, 7);
    results.documentsDeleted = docsResult.rowCount;
    
    // Clean up old processing logs (30 days)
    const logsResult = await cleanupProcessingLogs(client, 30);
    results.logsDeleted = logsResult.rowCount;
    
    // Optimize database
    await optimizeDatabase(client);
    
    // Get final stats
    if (!CONFIG.dryRun) {
      const finalStats = await getDatabaseStats(client);
      log('Final database statistics:');
      log(`  Documents: ${finalStats.documents}`);
      log(`  Document chunks: ${finalStats.documentChunks}`);
      log(`  Processing logs: ${finalStats.processingLogs}`);
      log(`  Database size: ${finalStats.databaseSize}`);
    }
    
    // Summary
    log('Cleanup summary:');
    log(`  Document chunks deleted: ${results.chunksDeleted}`);
    log(`  Documents deleted: ${results.documentsDeleted}`);
    log(`  Processing logs deleted: ${results.logsDeleted}`);
    
    log('Database cleanup completed successfully');
    
  } catch (error) {
    log(`Error during cleanup: ${error.message}`, 'error');
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
      verbose('Database connection closed');
    }
  }
}

// Show usage information
function showUsage() {
  console.log(`
Database Cleanup Script

Usage: node cleanup-database.js [options]

Options:
  --dry-run    Show what would be deleted without making changes
  --verbose    Show detailed logging information
  -v           Alias for --verbose
  --help       Show this help message

Environment Variables:
  DB_SECRET_ARN    ARN of the database credentials secret (required)
  AWS_REGION       AWS region (default: us-east-1)
  REGION           Alternative region variable

Examples:
  node cleanup-database.js --dry-run --verbose
  node cleanup-database.js
  DB_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789012:secret:db-creds node cleanup-database.js
`);
}

// Main execution
if (require.main === module) {
  if (process.argv.includes('--help')) {
    showUsage();
    process.exit(0);
  }
  
  runCleanup().catch(error => {
    log(`Fatal error: ${error.message}`, 'error');
    process.exit(1);
  });
}

module.exports = {
  runCleanup,
  cleanupOldDocumentChunks,
  cleanupOrphanedDocuments,
  cleanupProcessingLogs,
  optimizeDatabase,
  getDatabaseStats
};
