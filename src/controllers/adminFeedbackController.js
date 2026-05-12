/**
 * 管理员反馈后台控制器
 *
 * 规则：
 * 1. 反馈列表可按状态筛选：pending / processed / closed
 * 2. 管理员可编辑主题
 * 3. 管理员点击“已处理”后，会话状态变为 processed
 * 4. 用户再次回复 processed 会话后，状态自动变回 pending
 * 5. 管理员点击“关闭会话”后，状态变为 closed
 */

const { getDb } = require("../db/database");
const { createNotification } = require("../utils/notifications");

function statusText(status) {
	if (status === "processed") return "已处理";
	if (status === "closed") return "已关闭";
	return "待处理";
}

function normalizeStatus(value) {
	const s = (value || "").trim();
	if (["pending", "processed", "closed"].includes(s)) return s;
	return "";
}

function renderFeedbackList(req, res) {
	const db = getDb();
	const activeStatus = normalizeStatus(req.query.status);

	let where = "";
	const params = [];

	if (activeStatus) {
		where = "WHERE t.status = ?";
		params.push(activeStatus);
	}

	const threads = db
		.prepare(
			`
	SELECT
	  t.id, t.subject, t.status, t.created_at, t.updated_at,
	  CASE
		WHEN t.user_id IS NOT NULL THEN COALESCE(u.username, 'Unknown')
		ELSE '游客'
	  END AS from_name
	FROM feedback_threads t
	LEFT JOIN users u ON u.id = t.user_id
	${where}
	ORDER BY datetime(t.updated_at) DESC, t.id DESC
  `,
		)
		.all(...params);

	res.render("admin_feedback_list", {
		title: "反馈列表",
		activeStatus,
		threads: threads.map((x) => ({ ...x, status_text: statusText(x.status) })),
		msg: req.query.msg || null,
	});
}

function loadThreadDetail(db, threadId) {
	const thread = db
		.prepare(
			`
	SELECT
	  t.*,
	  CASE
		WHEN t.user_id IS NOT NULL THEN COALESCE(u.username, 'Unknown')
		ELSE '游客'
	  END AS from_name
	FROM feedback_threads t
	LEFT JOIN users u ON u.id = t.user_id
	WHERE t.id=?
  `,
		)
		.get(threadId);

	if (!thread) return null;

	const messages = db
		.prepare(
			`
	SELECT id, sender, content, created_at
	FROM feedback_messages
	WHERE thread_id=?
	ORDER BY id ASC
  `,
		)
		.all(threadId);

	const atts = db
		.prepare(
			`
	SELECT a.message_id, a.file_path, a.mime_type, a.size_bytes
	FROM feedback_attachments a
	JOIN feedback_messages m ON m.id=a.message_id
	WHERE m.thread_id=?
	ORDER BY a.id ASC
  `,
		)
		.all(threadId);

	const map = {};
	atts.forEach((a) => {
		if (!map[a.message_id]) map[a.message_id] = [];
		map[a.message_id].push(a);
	});

	return {
		thread,
		messages: messages.map((m) => ({ ...m, attachments: map[m.id] || [] })),
	};
}

function renderFeedbackThread(req, res) {
	const db = getDb();
	const id = Number(req.params.id);

	if (!Number.isFinite(id)) {
		return res.redirect("/admin/feedback?msg=参数错误");
	}

	const detail = loadThreadDetail(db, id);
	if (!detail) {
		return res.redirect("/admin/feedback?msg=会话不存在");
	}

	res.render("admin_feedback_thread", {
		title: "反馈详情",
		thread: { ...detail.thread, status_text: statusText(detail.thread.status) },
		messages: detail.messages,
		msg: req.query.msg || null,
	});
}

function updateThread(req, res) {
	const db = getDb();
	const id = Number(req.params.id);

	if (!Number.isFinite(id)) {
		return res.redirect("/admin/feedback?msg=参数错误");
	}

	const subject = (req.body.subject || "").trim().slice(0, 50);
	if (!subject) {
		return res.redirect(`/admin/feedback/${id}?msg=主题不能为空`);
	}

	db.prepare(
		`
	UPDATE feedback_threads
	SET subject=?, updated_at=datetime('now','localtime')
	WHERE id=?
  `,
	).run(subject, id);

	res.redirect(`/admin/feedback/${id}?msg=主题已更新`);
}

function markProcessed(req, res) {
	const db = getDb();
	const id = Number(req.params.id);

	if (!Number.isFinite(id)) {
		return res.redirect("/admin/feedback?msg=参数错误");
	}

	const thread = db
		.prepare(`SELECT id, user_id, status FROM feedback_threads WHERE id=?`)
		.get(id);
	if (!thread) {
		return res.redirect("/admin/feedback?msg=会话不存在");
	}

	if (thread.status === "closed") {
		return res.redirect(
			`/admin/feedback/${id}?msg=已关闭会话不能再标记为已处理`,
		);
	}

	db.prepare(
		`
	UPDATE feedback_threads
	SET status='processed', updated_at=datetime('now','localtime')
	WHERE id=?
  `,
	).run(id);

	res.redirect(`/admin/feedback/${id}?msg=已标记为已处理`);
}

function closeThread(req, res) {
	const db = getDb();
	const id = Number(req.params.id);

	if (!Number.isFinite(id)) {
		return res.redirect("/admin/feedback?msg=参数错误");
	}

	db.prepare(
		`
	UPDATE feedback_threads
	SET status='closed', updated_at=datetime('now','localtime')
	WHERE id=?
  `,
	).run(id);

	res.redirect(`/admin/feedback/${id}?msg=已关闭会话`);
}

function replyThread(req, res) {
	const db = getDb();
	const id = Number(req.params.id);

	if (!Number.isFinite(id)) {
		return res.redirect("/admin/feedback?msg=参数错误");
	}

	const content = (req.body.content || "").trim();

	if (!content) {
		return res.redirect(`/admin/feedback/${id}?msg=回复内容不能为空`);
	}

	if (content.length > 500) {
		return res.redirect(`/admin/feedback/${id}?msg=回复最多500字`);
	}

	const thread = db
		.prepare(`SELECT id, user_id, status FROM feedback_threads WHERE id=?`)
		.get(id);
	if (!thread) {
		return res.redirect("/admin/feedback?msg=会话不存在");
	}

	if (thread.status === "closed") {
		return res.redirect(`/admin/feedback/${id}?msg=会话已关闭，无法回复`);
	}

	const admin = req.session.user;

	db.prepare(
		`
	INSERT INTO feedback_messages (thread_id, sender, user_id, content)
	VALUES (?, 'admin', ?, ?)
  `,
	).run(id, admin.id, content);

	db.prepare(
		`
	UPDATE feedback_threads
	SET updated_at=datetime('now','localtime')
	WHERE id=?
  `,
	).run(id);

	if (thread.user_id) {
		createNotification({
			userId: thread.user_id,
			type: "feedback_reply",
			title: "管理员回复了你的反馈",
			content: content.slice(0, 120),
			linkUrl: "/#feedback",
			actorUserId: admin.id,
			feedbackThreadId: id,
		});
	}

	res.redirect(`/admin/feedback/${id}`);
}

module.exports = {
	renderFeedbackList,
	renderFeedbackThread,
	updateThread,
	markProcessed,
	closeThread,
	replyThread,
};
