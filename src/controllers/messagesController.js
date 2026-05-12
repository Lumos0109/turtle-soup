/**
 * 用户消息中心
 * 展示：
 * - 自己海龟汤下的新留言/回复
 * - 自己留言被回复
 * - 联系管理员被回复
 * - 发布公开汤审核通过/驳回
 */

const { getDb } = require("../db/database");

function typeText(type) {
	if (type === "soup_comment") return "我的海龟汤有新留言";
	if (type === "comment_reply") return "我的留言被回复";
	if (type === "feedback_reply") return "管理员回复";
	if (type === "soup_approved") return "审核通过";
	if (type === "soup_rejected") return "审核驳回";
	return "系统消息";
}

function renderMessages(req, res) {
	const db = getDb();
	const user = req.session.user;

	const messages = db.prepare(`
		SELECT *
		FROM notifications
		WHERE user_id=?
		ORDER BY datetime(created_at) DESC, id DESC
		LIMIT 100
	`).all(user.id).map((n) => ({
		...n,
		type_text: typeText(n.type),
	}));

	// 打开消息中心后，把消息标记为已读。
	db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0`).run(user.id);
	res.locals.unreadCount = 0;

	res.render("messages", {
		title: "消息",
		messages,
		msg: req.query.msg || null,
	});
}

module.exports = { renderMessages };
