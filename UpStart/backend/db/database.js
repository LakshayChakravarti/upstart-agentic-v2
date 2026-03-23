const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'upstart.db'));

// Enable WAL for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    skills TEXT,
    time_available TEXT,
    budget_level TEXT,
    experience_level TEXT,
    target_users TEXT,
    idea_data TEXT NOT NULL,
    selected_idea TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analysis_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id INTEGER NOT NULL,
    market TEXT,
    competitors TEXT,
    feasibility TEXT,
    tech_stack TEXT,
    monetization TEXT,
    roadmap TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
  );
`);

// Graceful migration for existing databases
try { db.exec(`ALTER TABLE ideas ADD COLUMN target_users TEXT`); } catch (e) { /* column already exists */ }
try { db.exec(`ALTER TABLE ideas ADD COLUMN user_elaboration TEXT`); } catch (e) { /* column already exists */ }
try { db.exec(`ALTER TABLE ideas ADD COLUMN strategic_direction TEXT`); } catch (e) { /* column already exists */ }
try { db.exec(`ALTER TABLE analysis_results ADD COLUMN adversarial TEXT`); } catch (e) { /* column already exists */ }

module.exports = db;
