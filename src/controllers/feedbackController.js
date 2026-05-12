/**
 * 用户侧反馈系统控制器
 *
 * 当前规则：
 * 1. 单条文字 <= 100 字
 * 2. 用户在“当前轮次”最多发 5 条文字消息
 * 3. 用户在“当前轮次”最多上传 3 张图片
 * 4. “当前轮次”指：管理员最后一次回复之后，到用户再次发送之间
 * 5. 管理员回复后，用户额度刷新为 5 条文字 + 3 张图片
 * 6. 若会话已关闭，用户侧提示关闭；再次点击联系管理员才新开会话
 */

const fs = require("fs");
const { getDb } = require("../db/database");
const config = require("../config");

const FEEDBACK_MAX_TEXT_LEN = Number(config.FEEDBACK_MAX_TEXT_LEN) || 100;
const FEEDBACK_MAX_USER_TEXT_MESSAGES =
	Number(config.FEEDBACK_MAX_USER_TEXT_MESSAGES) || 5;
const FEEDBACK_MAX_IMAGES_PER_THREAD =
	Number(config.FEEDBACK_MAX_IMAGES_PER_THREAD) || 3;
const FEEDBACK_MAX_IMAGE_BYTES =
	Number(config.FEEDBACK_MAX_IMAGE_BYTES) || 2 * 1024 * 1024;

function cleanupUploadedFiles(files) {
	(files || []).forEach((f) => {
		if (f && f.path) {
			try {
				fs.unlinkSync(f.path);
			} catch (e) {
				// 删除临时上传失败不影响主流程
			}
		}
	});
}

function getIdentity(req) {
	const u = req.session && req.session.user;
	if (u) return { userId: u.id, visitorToken: null };

	const vt = req.cookies && req.cookies.visitor_token;
	return { userId: null, visitorToken: vt || null };
}

function mapStatus(status) {
	if (status === "processed") return "已处理";
	if (status === "closed") return "已关闭";
	return "待处理";
}

function getLatestThread(db, identity) {
	if (identity.userId) {
		return db
			.prepare(
				`
	  SELECT * FROM feedback_threads
	  WHERE user_id = ?
	  ORDER BY datetime(updated_at) DESC, id DESC
	  LIMIT 1
	`,
			)
			.get(identity.userId);
	}

	if (identity.visitorToken) {
		return db
			.prepare(
				`
	  SELECT * FROM feedback_threads
	  WHERE visitor_token = ?
	  ORDER BY datetime(updated_at) DESC, id DESC
	  LIMIT 1
	`,
			)
			.get(identity.visitorToken);
	}

	return null;
}

function createThread(db, identity) {
	const info = db
		.prepare(
			`
	INSERT INTO feedback_threads (user_id, visitor_token, subject, status)
	VALUES (?, ?, '（未命名反馈）', 'pending')
  `,
		)
		.run(identity.userId, identity.visitorToken);

	return db
		.prepare(`SELECT * FROM feedback_threads WHERE id=?`)
		.get(info.lastInsertRowid);
}

/**
 * 找到本会话里“管理员最后一次回复”的 message id。
 * 用户额度只统计这个 id 之后的用户消息/图片。
 */
function getLastAdminMessageId(db, threadId) {
	const row = db
		.prepare(
			`
	SELECT id
	FROM feedback_messages
	WHERE thread_id=? AND sender='admin'
	ORDER BY id DESC
	LIMIT 1
  `,
		)
		.get(threadId);

	return row ? row.id : 0;
}

function countUserTextMessagesInCurrentRound(db, threadId) {
	const lastAdminId = getLastAdminMessageId(db, threadId);

	return db
		.prepare(
			`
	SELECT COUNT(1) AS c
	FROM feedback_messages
	WHERE thread_id=?
	  AND id > ?
	  AND sender='user'
	  AND content IS NOT NULL
	  AND TRIM(content) != ''
  `,
		)
		.get(threadId, lastAdminId).c;
}

function countUserImagesInCurrentRound(db, threadId) {
	const lastAdminId = getLastAdminMessageId(db, threadId);

	return db
		.prepare(
			`
	SELECT COUNT(1) AS c
	FROM feedback_attachments a
	JOIN feedback_messages m ON m.id = a.message_id
	WHERE m.thread_id=?
	  AND m.id > ?
	  AND m.sender='user'
  `,
		)
		.get(threadId, lastAdminId).c;
}

function loadMessages(db, threadId) {
	const msgs = db
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
	JOIN feedback_messages m ON m.id = a.message_id
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

	return msgs.map((m) => ({
		...m,
		attachments: map[m.id] || [],
	}));
}

function emptyThreadResponse() {
	return {
		thread: null,
		limits: {
			maxTextLen: FEEDBACK_MAX_TEXT_LEN,
			maxUserTextMessages: FEEDBACK_MAX_USER_TEXT_MESSAGES,
			maxImages: FEEDBACK_MAX_IMAGES_PER_THREAD,
			maxImageBytes: FEEDBACK_MAX_IMAGE_BYTES,
		},
		usage: {
			userTextCount: 0,
			imageCount: 0,
			remainingText: FEEDBACK_MAX_USER_TEXT_MESSAGES,
			remainingImages: FEEDBACK_MAX_IMAGES_PER_THREAD,
		},
		messages: [],
	};
}

function getThreadResponse(db, thread) {
	const userTextCount = countUserTextMessagesInCurrentRound(db, thread.id);
	const imageCount = countUserImagesInCurrentRound(db, thread.id);

	return {
		thread: {
			id: thread.id,
			subject: thread.subject,
			status: thread.status,
			statusText: mapStatus(thread.status),
			created_at: thread.created_at,
			updated_at: thread.updated_at,
		},
		limits: {
			maxTextLen: FEEDBACK_MAX_TEXT_LEN,
			maxUserTextMessages: FEEDBACK_MAX_USER_TEXT_MESSAGES,
			maxImages: FEEDBACK_MAX_IMAGES_PER_THREAD,
			maxImageBytes: FEEDBACK_MAX_IMAGE_BYTES,
		},
		usage: {
			userTextCount,
			imageCount,
			remainingText: Math.max(
				0,
				FEEDBACK_MAX_USER_TEXT_MESSAGES - userTextCount,
			),
			remainingImages: Math.max(0, FEEDBACK_MAX_IMAGES_PER_THREAD - imageCount),
		},
		messages: loadMessages(db, thread.id),
	};
}

/**
 * GET /feedback/thread
 *
 * 普通打开：
 * - 若最近会话已关闭，返回关闭会话，让用户看到“已关闭提示”
 *
 * 再次点击联系管理员：
 * - 前端会带 startNewIfClosed=1
 * - 若最近会话已关闭，则新建一个会话
 */
function getThread(req, res) {
	const db = getDb();
	const identity = getIdentity(req);

	if (!identity.userId && !identity.visitorToken) {
		return res.json(emptyThreadResponse());
	}

	let thread = getLatestThread(db, identity);

	if (!thread) {
		return res.json(emptyThreadResponse());
	}

	if (thread.status === "closed" && req.query.startNewIfClosed === "1") {
		thread = createThread(db, identity);
	}

	return res.json(getThreadResponse(db, thread));
}

/**
 * POST /feedback/message
 */
function postMessage(req, res) {
	const db = getDb();
	const identity = getIdentity(req);
	const files = req.files || [];

	if (!identity.userId && !identity.visitorToken) {
		cleanupUploadedFiles(files);
		return res
			.status(400)
			.json({ message: "无法识别访客身份，请刷新页面重试" });
	}

	let thread = getLatestThread(db, identity);
	if (!thread) {
		thread = createThread(db, identity);
	}

	/**
	 * 重要：
	 * 不再“关闭后自动新建并发送”。
	 * 关闭后必须先提示用户；用户再次点击联系管理员时，GET /feedback/thread?startNewIfClosed=1 才会创建新会话。
	 */
	if (thread.status === "closed") {
		cleanupUploadedFiles(files);
		return res.status(403).json({
			message: "会话已关闭，若还有其他疑问请再次联系管理员",
			code: "THREAD_CLOSED",
		});
	}

	const content = (req.body.content || "").trim();

	if (content.length > FEEDBACK_MAX_TEXT_LEN) {
		cleanupUploadedFiles(files);
		return res
			.status(400)
			.json({ message: `单条文字最多 ${FEEDBACK_MAX_TEXT_LEN} 字` });
	}

	if (!content && files.length === 0) {
		cleanupUploadedFiles(files);
		return res.status(400).json({ message: "请填写文字或选择图片再发送" });
	}

	if (content) {
		const userTextCount = countUserTextMessagesInCurrentRound(db, thread.id);
		if (userTextCount >= FEEDBACK_MAX_USER_TEXT_MESSAGES) {
			cleanupUploadedFiles(files);
			return res.status(400).json({
				message: "当前轮次已达到 5 条文字消息上限，请等待管理员回复后继续",
			});
		}
	}

	const imageCount = countUserImagesInCurrentRound(db, thread.id);
	if (imageCount + files.length > FEEDBACK_MAX_IMAGES_PER_THREAD) {
		cleanupUploadedFiles(files);
		return res.status(400).json({
			message: `当前轮次最多上传 ${FEEDBACK_MAX_IMAGES_PER_THREAD} 张图片，请等待管理员回复后继续`,
		});
	}

	const senderUserId = identity.userId || null;

	const msgInfo = db
		.prepare(
			`
	INSERT INTO feedback_messages (thread_id, sender, user_id, content)
	VALUES (?, 'user', ?, ?)
  `,
		)
		.run(thread.id, senderUserId, content || null);

	const messageId = msgInfo.lastInsertRowid;

	const insertAtt = db.prepare(`
	INSERT INTO feedback_attachments (message_id, file_path, mime_type, size_bytes)
	VALUES (?, ?, ?, ?)
  `);

	files.forEach((f) => {
		const filePath = `/uploads/feedback/${f.filename}`;
		insertAtt.run(messageId, filePath, f.mimetype, f.size);
	});

	if (content && thread.subject === "（未命名反馈）") {
		const brief = content.length > 12 ? content.slice(0, 12) + "…" : content;
		db.prepare(`UPDATE feedback_threads SET subject=? WHERE id=?`).run(
			brief,
			thread.id,
		);
	}

	/**
	 * 若管理员已标记“已处理”，用户再次回复后自动变回“待处理”。
	 */
	const nextStatus = thread.status === "processed" ? "pending" : thread.status;

	db.prepare(
		`
	UPDATE feedback_threads
	SET status=?, updated_at=datetime('now','localtime')
	WHERE id=?
  `,
	).run(nextStatus, thread.id);

	const updated = db
		.prepare(`SELECT * FROM feedback_threads WHERE id=?`)
		.get(thread.id);
	return res.json(getThreadResponse(db, updated));
}

module.exports = { getThread, postMessage };
