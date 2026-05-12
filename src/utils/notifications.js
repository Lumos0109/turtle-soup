/**
 * 站内消息/通知工具
 * - createNotification：写入一条站内通知
 * - getUnreadCount：导航栏显示未读数
 */

const { getDb } = require("../db/database");

function createNotification(options) {
	const db = getDb();
	const userId = Number(options.userId);
	if (!Number.isFinite(userId)) return;

	const title = String(options.title || "系统消息").trim().slice(0, 80);
	const content = String(options.content || "").trim().slice(0, 500);
	const type = String(options.type || "system").trim().slice(0, 40);
	const linkUrl = String(options.linkUrl || "").trim().slice(0, 300) || null;

	db.prepare(`
		INSERT INTO notifications
		(user_id, type, title, content, link_url, actor_user_id, soup_id, comment_id, feedback_thread_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).run(
		userId,
		type,
		title || "系统消息",
		content,
		linkUrl,
		options.actorUserId || null,
		options.soupId || null,
		options.commentId || null,
		options.feedbackThreadId || null,
	);
}

function getUnreadCount(userId) {
	const db = getDb();
	if (!userId) return 0;
	const row = db.prepare(`
		SELECT COUNT(1) AS c
		FROM notifications
		WHERE user_id=? AND is_read=0
	`).get(userId);
	return row ? row.c : 0;
}

module.exports = { createNotification, getUnreadCount };
