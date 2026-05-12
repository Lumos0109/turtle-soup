/**
 * 修改管理员密码脚本
 * 用法：
 * node scripts/set_admin_password.js "你的新密码"
 */

const bcrypt = require("bcryptjs");
const { initDatabase, getDb } = require("../src/db/database");
const { ADMIN_USERNAME } = require("../src/config");

const newPassword = process.argv[2] || process.env.ADMIN_PASSWORD;

if (!newPassword || newPassword.length < 8) {
	console.error("❌ 请提供至少 8 位的新管理员密码");
	console.error(
		'示例：node scripts/set_admin_password.js "NewStrongPassword123!"',
	);
	process.exit(1);
}

initDatabase();

const db = getDb();
const hash = bcrypt.hashSync(newPassword, 10);

const info = db
	.prepare(`UPDATE users SET password_hash=? WHERE username=? AND role='admin'`)
	.run(hash, ADMIN_USERNAME);

if (info.changes === 0) {
	db.prepare(
		`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`,
	).run(ADMIN_USERNAME, hash);
}

console.log(`✅ 管理员 ${ADMIN_USERNAME} 的密码已更新`);
