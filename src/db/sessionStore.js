const session = require("express-session");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

/**
 * SQLite session store.
 *
 * 只保存登录态，不保存业务数据。这样项目只依赖 better-sqlite3，避免同时维护
 * sqlite3 / better-sqlite3 两套原生依赖导致 Windows、Linux、Docker 之间迁移困难。
 */
class BetterSqliteSessionStore extends session.Store {
	constructor(options = {}) {
		super();
		this.file = options.file;
		if (!this.file) throw new Error("Session store requires a sqlite file path");

		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		this.db = new Database(this.file);
		this.db.pragma("journal_mode = WAL");

		// 旧版 connect-sqlite3 也可能叫 sessions，但列结构不同；登录态可丢弃，业务数据不受影响。
		const existingColumns = this.db.prepare("PRAGMA table_info(sessions)").all().map((row) => row.name);
		if (existingColumns.length && !["sid", "expires_at", "data"].every((name) => existingColumns.includes(name))) {
			this.db.exec(`ALTER TABLE sessions RENAME TO sessions_legacy_${Date.now()}`);
		}

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				sid TEXT PRIMARY KEY,
				expires_at INTEGER NOT NULL,
				data TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
		`);

		this.statements = {
			get: this.db.prepare("SELECT data FROM sessions WHERE sid=? AND expires_at > ?"),
			set: this.db.prepare(`
				INSERT INTO sessions (sid, expires_at, data)
				VALUES (?, ?, ?)
				ON CONFLICT(sid) DO UPDATE SET expires_at=excluded.expires_at, data=excluded.data
			`),
			destroy: this.db.prepare("DELETE FROM sessions WHERE sid=?"),
			clearExpired: this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
		};
	}

	get(sid, callback) {
		try {
			const row = this.statements.get.get(sid, Date.now());
			callback(null, row ? JSON.parse(row.data) : null);
		} catch (error) {
			callback(error);
		}
	}

	set(sid, sess, callback = () => {}) {
		try {
			const expiresAt = sess.cookie?.expires
				? new Date(sess.cookie.expires).getTime()
				: Date.now() + 7 * 24 * 60 * 60 * 1000;
			this.statements.set.run(sid, expiresAt, JSON.stringify(sess));
			callback(null);
		} catch (error) {
			callback(error);
		}
	}

	destroy(sid, callback = () => {}) {
		try {
			this.statements.destroy.run(sid);
			callback(null);
		} catch (error) {
			callback(error);
		}
	}

	cleanupExpired() {
		return this.statements.clearExpired.run(Date.now()).changes;
	}
}

module.exports = BetterSqliteSessionStore;
