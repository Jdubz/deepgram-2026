/**
 * Database Connection & Migration Manager
 *
 * Provides a singleton database connection and handles schema migrations.
 * Migrations are stored in the migrations/ folder and applied in order.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Database file path
const DATA_DIR = path.resolve(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "deepgram.db");

// Migrations directory
const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");

interface Migration {
  version: number;
  name: string;
  sql: string;
}

interface AppliedMigration {
  version: number;
  name: string;
  applied_at: string;
}

class DatabaseManager {
  private db: Database.Database | null = null;

  /**
   * Get the database connection (lazy initialization)
   */
  getConnection(): Database.Database {
    if (!this.db) {
      // Ensure data directory exists
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      this.db = new Database(DB_PATH);

      // Enable foreign key enforcement (MUST be set before any queries)
      this.db.pragma("foreign_keys = ON");

      // Enable WAL mode for better concurrency
      this.db.pragma("journal_mode = WAL");

      // Set busy timeout to handle concurrent access
      this.db.pragma("busy_timeout = 30000");
    }
    return this.db;
  }

  /**
   * Initialize the database and run pending migrations
   */
  initialize(): void {
    const db = this.getConnection();

    // Create schema_migrations table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Run pending migrations
    this.runMigrations();
  }

  /**
   * Load migration files from the migrations directory
   */
  private loadMigrations(): Migration[] {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.warn(`Migrations directory not found: ${MIGRATIONS_DIR}`);
      return [];
    }

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith(".sql"))
      .sort();

    const migrations: Migration[] = [];

    for (const file of files) {
      // Parse version from filename (e.g., "001_initial.sql" -> version 1)
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) {
        console.warn(`Skipping invalid migration filename: ${file}`);
        continue;
      }

      const version = parseInt(match[1], 10);
      const name = match[2];
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");

      migrations.push({ version, name, sql });
    }

    return migrations;
  }

  /**
   * Get list of applied migrations from the database
   */
  private getAppliedMigrations(): AppliedMigration[] {
    const db = this.getConnection();
    const stmt = db.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version");
    return stmt.all() as AppliedMigration[];
  }

  /**
   * Run all pending migrations
   */
  private runMigrations(): void {
    const db = this.getConnection();
    const migrations = this.loadMigrations();
    const applied = this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map(m => m.version));

    const pending = migrations.filter(m => !appliedVersions.has(m.version));

    if (pending.length === 0) {
      return;
    }

    console.log(`Running ${pending.length} pending migration(s)...`);

    for (const migration of pending) {
      console.log(`  Applying migration ${migration.version}: ${migration.name}`);

      try {
        // Run migration in a transaction
        db.exec("BEGIN TRANSACTION");
        db.exec(migration.sql);

        // Record the migration
        const stmt = db.prepare(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)"
        );
        stmt.run(migration.version, migration.name);

        db.exec("COMMIT");
        console.log(`  Migration ${migration.version} applied successfully`);
      } catch (error) {
        db.exec("ROLLBACK");
        console.error(`  Migration ${migration.version} failed:`, error);
        throw error;
      }
    }

    console.log("All migrations applied successfully");
  }

  /**
   * Get current schema version
   */
  getSchemaVersion(): number {
    const db = this.getConnection();
    const stmt = db.prepare("SELECT MAX(version) as version FROM schema_migrations");
    const result = stmt.get() as { version: number | null };
    return result.version || 0;
  }

  /**
   * Check if the database has been initialized
   */
  isInitialized(): boolean {
    try {
      const db = this.getConnection();
      const result = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
        .get();
      return !!result;
    } catch {
      return false;
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get the database file path (for debugging)
   */
  getDbPath(): string {
    return DB_PATH;
  }
}

// Export singleton instance
export const database = new DatabaseManager();

// Export the Database type for type annotations
export type { Database };
