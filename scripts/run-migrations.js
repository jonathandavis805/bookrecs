#!/usr/bin/env node

/**
 * Idempotent migration runner for Cloudflare D1
 * 
 * Handles ALTER TABLE ADD COLUMN statements idempotently by checking
 * if columns already exist before attempting to add them.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_NAME = 'bookrecs-db';

function runD1Command(command, options = {}) {
  const jsonFlag = options.json ? '--json' : '';
  const fileFlag = options.file ? `--file="${options.file}"` : '';
  const commandFlag = command ? `--command="${command.replace(/"/g, '\\"')}"` : '';
  
  // Don't use both --file and --command together
  const cmd = `wrangler d1 execute ${DB_NAME} --remote --yes ${jsonFlag} ${fileFlag} ${commandFlag}`.trim();
  
  try {
    const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output: result };
  } catch (error) {
    return { 
      success: false, 
      output: error.stdout || '', 
      error: error.stderr || error.message 
    };
  }
}

function createTrackingTable() {
  console.log('📋 Ensuring schema_migrations table exists...');
  runD1Command(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

function isMigrationApplied(filename) {
  const result = runD1Command(
    `SELECT filename FROM schema_migrations WHERE filename = '${filename}'`,
    { json: true }
  );
  
  if (!result.success) return false;
  
  try {
    const parsed = JSON.parse(result.output);
    // Wrangler returns: [{ results: [...], success: true, ... }]
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    const results = data.results || [];
    return results.some(row => row.filename === filename);
  } catch {
    return false;
  }
}

function columnExists(tableName, columnName) {
  const result = runD1Command(
    `SELECT name FROM pragma_table_info('${tableName}') WHERE name='${columnName}'`,
    { json: true }
  );
  
  if (!result.success) return false;
  
  try {
    const parsed = JSON.parse(result.output);
    // Wrangler returns: [{ results: [...], success: true, ... }]
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    const results = data.results || [];
    return results.some(row => row.name === columnName);
  } catch {
    return false;
  }
}

function markMigrationApplied(filename) {
  runD1Command(`INSERT OR IGNORE INTO schema_migrations (filename) VALUES ('${filename}')`);
}

function parseAlterTableAddColumn(statement) {
  // Match: ALTER TABLE <table> ADD COLUMN <column>
  const match = statement.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i);
  if (match) {
    return { table: match[1], column: match[2] };
  }
  return null;
}

function applyMigration(filePath, filename) {
  console.log(`\n→ Applying ${filename}`);
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const statements = content
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));
  
  const statementsToExecute = [];
  
  for (const statement of statements) {
    const alterInfo = parseAlterTableAddColumn(statement);
    
    if (alterInfo) {
      // Check if column already exists
      if (columnExists(alterInfo.table, alterInfo.column)) {
        console.log(`  ⚠ Column ${alterInfo.table}.${alterInfo.column} already exists, skipping`);
      } else {
        statementsToExecute.push(statement);
      }
    } else {
      // For non-ALTER statements, include them
      statementsToExecute.push(statement);
    }
  }
  
  if (statementsToExecute.length === 0) {
    console.log(`  ✓ All changes already applied`);
    markMigrationApplied(filename);
    return true;
  }
  
  // Execute the filtered statements
  const filteredContent = statementsToExecute.join(';\n') + ';';
  const tempFile = path.join('/tmp', `migration_${filename}`);
  fs.writeFileSync(tempFile, filteredContent);
  
  const result = runD1Command('', { file: tempFile });
  
  if (result.success) {
    markMigrationApplied(filename);
    console.log(`  ✓ ${filename} applied successfully`);
    fs.unlinkSync(tempFile);
    return true;
  } else {
    console.error(`  ✗ Migration failed:`);
    console.error(result.error);
    fs.unlinkSync(tempFile);
    return false;
  }
}

function main() {
  console.log('🚀 Starting idempotent migration runner...\n');
  
  createTrackingTable();
  
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  let allSuccess = true;
  
  for (const filename of files) {
    if (isMigrationApplied(filename)) {
      console.log(`✓ Skipping ${filename} (already applied)`);
      continue;
    }
    
    const filePath = path.join(migrationsDir, filename);
    const success = applyMigration(filePath, filename);
    
    if (!success) {
      allSuccess = false;
      console.error(`\n✗ Migration ${filename} failed. Stopping.`);
      break;
    }
  }
  
  if (allSuccess) {
    console.log('\n✅ All migrations applied successfully');
    process.exit(0);
  } else {
    console.error('\n❌ Migration failed');
    process.exit(1);
  }
}

main();
