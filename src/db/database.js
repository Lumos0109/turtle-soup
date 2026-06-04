const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const {
	DB_FILE,
	ADMIN_USERNAME,
	ADMIN_PASSWORD,
	CREATE_DEMO_DATA,
} = require("../config");

let db;

function getDb() {
	if (!db) {
		fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
		db = new Database(DB_FILE);
		db.pragma("foreign_keys = ON");
		db.pragma("journal_mode = WAL");
	}
	return db;
}

function execMany(statements) {
	const conn = getDb();
	for (const sql of statements) conn.exec(sql);
}

function columnExists(table, column) {
	return getDb().prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function ensureColumn(table, column, definition) {
	if (!columnExists(table, column)) {
		getDb().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
	}
}

/** 创建全量表结构：新部署会直接得到最新结构，旧库不会被覆盖。 */
function createTables() {
	execMany([
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			is_disabled INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
		);`,

		`CREATE TABLE IF NOT EXISTS soups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			surface TEXT NOT NULL,
			bottom TEXT NOT NULL,
			has_host_manual INTEGER NOT NULL DEFAULT 0,
			host_manual TEXT,
			author_id INTEGER,
			is_anonymous INTEGER NOT NULL DEFAULT 0,
			visibility TEXT NOT NULL DEFAULT 'public',
			status TEXT NOT NULL DEFAULT 'pending',
			review_note TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (author_id) REFERENCES users(id)
		);`,

		`CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			sort_order INTEGER DEFAULT 0,
			is_hidden INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
		);`,

		`CREATE TABLE IF NOT EXISTS soup_tags (
			soup_id INTEGER NOT NULL,
			tag_id INTEGER NOT NULL,
			PRIMARY KEY (soup_id, tag_id),
			FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
			FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS likes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			soup_id INTEGER NOT NULL,
			user_id INTEGER,
			visitor_token TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE (soup_id, user_id),
			UNIQUE (soup_id, visitor_token)
		);`,

		`CREATE TABLE IF NOT EXISTS soup_ratings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			soup_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			score INTEGER NOT NULL CHECK (score IN (2, 4, 6, 8, 10)),
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE (soup_id, user_id)
		);`,

		`CREATE TABLE IF NOT EXISTS comments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			soup_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			parent_id INTEGER,
			content TEXT NOT NULL,
			is_deleted INTEGER NOT NULL DEFAULT 0,
			is_pinned INTEGER NOT NULL DEFAULT 0,
			pinned_at TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS audits (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			soup_id INTEGER NOT NULL,
			admin_id INTEGER NOT NULL,
			action TEXT NOT NULL,
			note TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
			FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS share_codes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			soup_id INTEGER NOT NULL UNIQUE,
			code TEXT NOT NULL UNIQUE,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS feedback_threads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER,
			visitor_token TEXT,
			subject TEXT NOT NULL DEFAULT '（未命名反馈）',
			status TEXT NOT NULL DEFAULT 'pending',
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
		);`,

		`CREATE TABLE IF NOT EXISTS feedback_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			thread_id INTEGER NOT NULL,
			sender TEXT NOT NULL,
			user_id INTEGER,
			content TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (thread_id) REFERENCES feedback_threads(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
		);`,

		`CREATE TABLE IF NOT EXISTS feedback_attachments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL,
			file_path TEXT NOT NULL,
			mime_type TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (message_id) REFERENCES feedback_messages(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS announcements (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
		);`,

		`CREATE TABLE IF NOT EXISTS notifications (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			type TEXT NOT NULL,
			title TEXT NOT NULL,
			content TEXT,
			link_url TEXT,
			actor_user_id INTEGER,
			soup_id INTEGER,
			comment_id INTEGER,
			feedback_thread_id INTEGER,
			is_read INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
			FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE,
			FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
			FOREIGN KEY (feedback_thread_id) REFERENCES feedback_threads(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS facilitator_usage (
			user_id INTEGER NOT NULL,
			quota_day TEXT NOT NULL,
			query_count INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (user_id, quota_day),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS soup_reveals (
			user_id INTEGER NOT NULL,
			soup_id INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			PRIMARY KEY (user_id, soup_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS rooms (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT NOT NULL UNIQUE,
			host_user_id INTEGER,
			soup_id INTEGER,
			status TEXT NOT NULL DEFAULT 'waiting',
			ai_host_enabled INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			last_activity_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			closed_at TEXT,
			FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE SET NULL,
			FOREIGN KEY (soup_id) REFERENCES soups(id) ON DELETE SET NULL
		);`,

		`CREATE TABLE IF NOT EXISTS room_members (
			room_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			role TEXT NOT NULL DEFAULT 'viewer',
			joined_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			last_seen_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			PRIMARY KEY (room_id, user_id),
			FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS room_questions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			room_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			content TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			answer TEXT,
			answered_by INTEGER,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			answered_at TEXT,
			FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (answered_by) REFERENCES users(id) ON DELETE SET NULL
		);`,

		`CREATE TABLE IF NOT EXISTS room_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			room_id INTEGER NOT NULL,
			user_id INTEGER,
			type TEXT NOT NULL,
			content TEXT,
			question_id INTEGER,
			answer TEXT,
			images_json TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
			FOREIGN KEY (question_id) REFERENCES room_questions(id) ON DELETE SET NULL
		);`,

		`CREATE TABLE IF NOT EXISTS room_stickers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			url TEXT NOT NULL,
			filename TEXT NOT NULL,
			original_name TEXT,
			is_deleted INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
		);`,

		`CREATE TABLE IF NOT EXISTS room_bottom_reveals (
			room_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			PRIMARY KEY (room_id, user_id),
			FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS room_finish_votes (
			room_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			vote TEXT NOT NULL DEFAULT 'yes',
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
			PRIMARY KEY (room_id, user_id),
			FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
	]);
}

/** 只补字段，不删除、不重建表，保证生产数据可直接复制升级。 */
function migrate() {
	createTables();

	ensureColumn("soups", "review_note", "TEXT");
	ensureColumn("soups", "has_host_manual", "INTEGER NOT NULL DEFAULT 0");
	ensureColumn("soups", "host_manual", "TEXT");
	ensureColumn("tags", "sort_order", "INTEGER DEFAULT 0");
	ensureColumn("tags", "is_hidden", "INTEGER NOT NULL DEFAULT 0");
	ensureColumn("comments", "parent_id", "INTEGER");
	ensureColumn("comments", "is_deleted", "INTEGER NOT NULL DEFAULT 0");
	ensureColumn("comments", "is_pinned", "INTEGER NOT NULL DEFAULT 0");
	ensureColumn("comments", "pinned_at", "TEXT");
	ensureColumn("rooms", "ai_host_enabled", "INTEGER NOT NULL DEFAULT 0");
	ensureColumn("room_events", "images_json", "TEXT");
	ensureColumn("room_stickers", "original_name", "TEXT");
	ensureColumn("room_stickers", "is_deleted", "INTEGER NOT NULL DEFAULT 0");

	execMany([
		"CREATE INDEX IF NOT EXISTS idx_soup_ratings_soup ON soup_ratings(soup_id);",
		"CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);",
		"CREATE INDEX IF NOT EXISTS idx_comments_pinned ON comments(soup_id, is_pinned, pinned_at);",
		"CREATE INDEX IF NOT EXISTS idx_feedback_threads_updated ON feedback_threads(updated_at);",
		"CREATE INDEX IF NOT EXISTS idx_feedback_messages_thread ON feedback_messages(thread_id);",
		"CREATE INDEX IF NOT EXISTS idx_announcements_active_updated ON announcements(is_active, updated_at);",
		"CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at);",
		"CREATE INDEX IF NOT EXISTS idx_soup_reveals_user ON soup_reveals(user_id, soup_id);",
		"CREATE INDEX IF NOT EXISTS idx_rooms_status_activity ON rooms(status, last_activity_at);",
		"CREATE INDEX IF NOT EXISTS idx_room_members_seen ON room_members(room_id, last_seen_at);",
		"CREATE INDEX IF NOT EXISTS idx_room_questions_room ON room_questions(room_id, id);",
		"CREATE INDEX IF NOT EXISTS idx_room_events_room_id ON room_events(room_id, id);",
		"CREATE INDEX IF NOT EXISTS idx_room_stickers_active ON room_stickers(is_deleted, id);",
		"CREATE INDEX IF NOT EXISTS idx_room_bottom_reveals_room ON room_bottom_reveals(room_id, user_id);",
		"CREATE INDEX IF NOT EXISTS idx_room_finish_votes_room ON room_finish_votes(room_id, vote);",
	]);

	getDb().prepare(`UPDATE tags SET sort_order=id WHERE sort_order IS NULL OR sort_order=0`).run();
}

function seedInitialData() {
	const conn = getDb();
	const insertTag = conn.prepare("INSERT OR IGNORE INTO tags (name, sort_order, is_hidden) VALUES (?, ?, 0)");
	["红汤", "搞笑", "恐怖"].forEach((name, index) => insertTag.run(name, (index + 1) * 10));

	const findUser = conn.prepare("SELECT id FROM users WHERE username=?");
	if (!findUser.get(ADMIN_USERNAME)) {
		const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
		conn.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
			.run(ADMIN_USERNAME, hash);
	}

	if (!CREATE_DEMO_DATA) return;

	const demoUser = "user1";
	if (!findUser.get(demoUser)) {
		const hash = bcrypt.hashSync("User123!", 10);
		conn.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')")
			.run(demoUser, hash);
	}

	const soupCount = conn.prepare("SELECT COUNT(1) AS c FROM soups").get().c;
	if (soupCount > 0) return;

	const userId = findUser.get(demoUser)?.id || null;
	const insertSoup = conn.prepare(`
		INSERT INTO soups (title, surface, bottom, author_id, is_anonymous, visibility, status)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`);
	insertSoup.run(
		"电梯里的男人",
		"男人每天都坐电梯上班，有一天他走进电梯后突然大笑，然后辞职了。",
		"他是盲人，平时按电梯按钮靠摸盲文。那天电梯按钮被换成平面触摸屏，他摸不到盲文，才意识到自己被公司“升级”排除，于是大笑辞职。",
		userId,
		0,
		"public",
		"approved",
	);
	insertSoup.run(
		"雨伞",
		"他带着雨伞出门，回家后却浑身湿透。",
		"他出门时没下雨，雨伞是用来遮阳的；回家时突然暴雨，他把伞借给了别人。",
		userId,
		1,
		"public",
		"pending",
	);
	insertSoup.run(
		"只有代码能看到的汤",
		"这碗汤不会出现在公开汤池里。",
		"它是私密汤，只能通过分享码访问，分享码 24 小时有效。",
		userId,
		1,
		"private",
		"approved",
	);

	const getTagId = conn.prepare("SELECT id FROM tags WHERE name=?");
	const getSoupId = conn.prepare("SELECT id FROM soups WHERE title=?");
	const link = conn.prepare("INSERT OR IGNORE INTO soup_tags (soup_id, tag_id) VALUES (?, ?)");
	const links = [
		["电梯里的男人", "红汤"],
		["雨伞", "搞笑"],
		["电梯里的男人", "恐怖"],
	];
	for (const [title, tag] of links) {
		const soupId = getSoupId.get(title)?.id;
		const tagId = getTagId.get(tag)?.id;
		if (soupId && tagId) link.run(soupId, tagId);
	}
}

function initDatabase() {
	migrate();
	seedInitialData();
}

module.exports = { getDb, initDatabase, migrate };
