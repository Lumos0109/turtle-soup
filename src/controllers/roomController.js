const crypto = require("crypto");
const { getDb } = require("../db/database");
const config = require("../config");
const { answerSoupQuestion } = require("./facilitatorController");

const ANSWER_VALUES = new Set(["yes", "no", "partial", "irrelevant"]);
const ANSWER_TEXT = {
	yes: "是",
	no: "否",
	partial: "部分是",
	irrelevant: "无关",
};
const AI_HOST_TIP = "当前房间是AI主持人，AI有些笨笨的，有些关键问题记得反复确认喔~如果你认为已经推导出汤底了，可以直接查看！";

function nowSqlExpr() {
	return "datetime('now','localtime')";
}

function toInt(value, fallback = 0) {
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function jsonParseArray(str) {
	try {
		const arr = JSON.parse(str || "[]");
		return Array.isArray(arr) ? arr : [];
	} catch (_) {
		return [];
	}
}

function generateRoomCode() {
	return crypto.randomBytes(4).toString("hex");
}

function touchRoom(db, roomId) {
	db.prepare(`UPDATE rooms SET updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()} WHERE id=?`).run(roomId);
}

function markRoomLeft(db, room, user, options = {}) {
	if (!db || !room || !user) return false;
	const member = db.prepare(`SELECT role FROM room_members WHERE room_id=? AND user_id=?`).get(room.id, user.id);
	const wasHost = Number(room.host_user_id || 0) === Number(user.id);
	if (!member && !wasHost) return false;

	db.prepare(`
		UPDATE room_members
		SET role=CASE WHEN role='host' THEN 'viewer' ELSE role END,
			last_seen_at=datetime('now','localtime','-10 minutes')
		WHERE room_id=? AND user_id=?
	`).run(room.id, user.id);

	if (wasHost) {
		db.prepare(`UPDATE rooms SET host_user_id=NULL, updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()} WHERE id=?`).run(room.id);
	}

	if (options.addEvent !== false) {
		addEvent(db, room.id, user.id, "leave", { content: `${user.username} 离开了房间` });
	} else {
		touchRoom(db, room.id);
	}
	return true;
}

function leaveOtherRoomsForUser(db, user, excludeRoomId = null) {
	if (!user) return 0;
	const offlineSeconds = Number(config.ROOM_MEMBER_OFFLINE_SECONDS) || 35;
	const rooms = db.prepare(`
		SELECT DISTINCT r.*
		FROM rooms r
		LEFT JOIN room_members rm ON rm.room_id=r.id AND rm.user_id=?
		WHERE r.status != 'closed'
		  AND (? IS NULL OR r.id != ?)
		  AND (
			r.host_user_id=?
			OR datetime(rm.last_seen_at) >= datetime('now','localtime', ?)
		  )
		ORDER BY datetime(r.last_activity_at) DESC, r.id DESC
	`).all(user.id, excludeRoomId, excludeRoomId, user.id, `-${offlineSeconds} seconds`);
	let count = 0;
	for (const otherRoom of rooms) {
		if (markRoomLeft(db, otherRoom, user, { addEvent: true })) count += 1;
	}
	return count;
}

function setCurrentRoomSession(req, roomId) {
	if (req && req.session) req.session.currentRoomId = roomId || null;
}

function clearCurrentRoomSession(req, roomId) {
	if (!req || !req.session) return;
	if (!roomId || Number(req.session.currentRoomId || 0) === Number(roomId)) {
		req.session.currentRoomId = null;
	}
}

function addEvent(db, roomId, userId, type, options = {}) {
	const info = db.prepare(`
		INSERT INTO room_events (room_id, user_id, type, content, question_id, answer, images_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`).run(
		roomId,
		userId || null,
		type,
		options.content || null,
		options.questionId || null,
		options.answer || null,
		options.imagesJson || null,
	);
	touchRoom(db, roomId);
	return info.lastInsertRowid;
}

function cleanupRooms() {
	const db = getDb();
	const waitingMinutes = Number(config.ROOM_WAITING_IDLE_MINUTES) || 30;
	const playingMinutes = Number(config.ROOM_PLAYING_IDLE_MINUTES) || 180;

	db.prepare(`
		UPDATE rooms
		SET status='closed', closed_at=${nowSqlExpr()}, updated_at=${nowSqlExpr()}
		WHERE status != 'closed'
		  AND (
			(status IN ('waiting', 'finished') AND datetime(last_activity_at) < datetime('now','localtime', ?))
			OR
			(status='playing' AND datetime(last_activity_at) < datetime('now','localtime', ?))
		  )
	`).run(`-${waitingMinutes} minutes`, `-${playingMinutes} minutes`);
}

function getRoomByCode(code) {
	const db = getDb();
	return db.prepare(`SELECT * FROM rooms WHERE code=?`).get(code);
}

function requireRoom(req, res) {
	cleanupRooms();
	const code = String(req.params.code || "").trim();
	const room = getRoomByCode(code);
	if (!room || room.status === "closed") {
		res.status(404).json({ message: "房间不存在或已关闭" });
		return null;
	}
	return room;
}

function requireHost(req, res, room) {
	const user = req.session.user;
	if (!user) {
		res.status(401).json({ message: "请先登录" });
		return false;
	}
	if (!room.host_user_id || Number(room.host_user_id) !== Number(user.id)) {
		res.status(403).json({ message: "只有主持人可以操作" });
		return false;
	}
	return true;
}

function isHost(room, user) {
	return !!(user && room && Number(room.host_user_id) === Number(user.id));
}

function isAiHostEnabled(room) {
	return Number(room?.ai_host_enabled || 0) === 1;
}

function canUseAiHostPicker(room, user) {
	if (!room || !user) return false;
	if (room.status !== "waiting") return false;
	if (room.soup_id) return false;
	if (room.host_user_id) return false;
	if (isAiHostEnabled(room)) return false;
	return true;
}

function getOnlineMemberCount(db, roomId) {
	return Number(countOnlineMembers(db, roomId) || 0);
}

function getFinishVoteState(db, roomId) {
	const onlineCount = getOnlineMemberCount(db, roomId);
	const row = db.prepare(`
		SELECT
			SUM(CASE WHEN vote='yes' THEN 1 ELSE 0 END) AS yes_count,
			SUM(CASE WHEN vote='no' THEN 1 ELSE 0 END) AS no_count
		FROM room_finish_votes
		WHERE room_id=?
	`).get(roomId);
	const yesCount = Number(row?.yes_count || 0);
	const noCount = Number(row?.no_count || 0);
	return {
		yesCount,
		noCount,
		onlineCount,
		needed: Math.floor(onlineCount / 2) + 1,
		passed: yesCount > onlineCount / 2,
	};
}

function ensureMember(db, room, user, shouldCreateJoinEvent = false) {
	const existing = db.prepare(`SELECT * FROM room_members WHERE room_id=? AND user_id=?`).get(room.id, user.id);
	const role = room.host_user_id && Number(room.host_user_id) === Number(user.id) ? "host" : "viewer";
	const offlineSeconds = Number(config.ROOM_MEMBER_OFFLINE_SECONDS) || 35;

	if (existing) {
		const wasOnline = Number(db.prepare(`
			SELECT CASE WHEN datetime(?) >= datetime('now','localtime', ?) THEN 1 ELSE 0 END AS online
		`).get(existing.last_seen_at, `-${offlineSeconds} seconds`).online || 0) === 1;
		db.prepare(`UPDATE room_members SET role=?, last_seen_at=${nowSqlExpr()} WHERE room_id=? AND user_id=?`).run(role, room.id, user.id);
		if (shouldCreateJoinEvent && !wasOnline) {
			addEvent(db, room.id, user.id, "join", { content: `${user.username} 进入了房间` });
			if (isAiHostEnabled(room) && room.status === "playing") addEvent(db, room.id, null, "system", { content: AI_HOST_TIP });
		}
		return { joined: false, role };
	}

	leaveOtherRoomsForUser(db, user, room.id);

	const onlineCount = countOnlineMembers(db, room.id);
	const maxMembers = Number(config.ROOM_MAX_MEMBERS) || 12;
	if (onlineCount >= maxMembers) {
		const error = new Error(`房间人数已满（最多 ${maxMembers} 人）`);
		error.statusCode = 403;
		throw error;
	}

	db.prepare(`INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)`).run(room.id, user.id, role);
	if (shouldCreateJoinEvent) {
		addEvent(db, room.id, user.id, "join", { content: `${user.username} 进入了房间` });
		if (isAiHostEnabled(room) && room.status === "playing") addEvent(db, room.id, null, "system", { content: AI_HOST_TIP });
	}
	return { joined: true, role };
}

function countOnlineMembers(db, roomId) {
	const offlineSeconds = Number(config.ROOM_MEMBER_OFFLINE_SECONDS) || 35;
	return db.prepare(`
		SELECT COUNT(1) AS c
		FROM room_members
		WHERE room_id=? AND datetime(last_seen_at) >= datetime('now','localtime', ?)
	`).get(roomId, `-${offlineSeconds} seconds`).c;
}

function getActiveRoomForUser(db, userId, excludeRoomId = null) {
	const offlineSeconds = Number(config.ROOM_MEMBER_OFFLINE_SECONDS) || 35;
	return db.prepare(`
		SELECT r.id, r.code, r.status, r.host_user_id, r.soup_id
		FROM room_members rm
		JOIN rooms r ON r.id=rm.room_id
		WHERE rm.user_id=?
		  AND r.status != 'closed'
		  AND datetime(rm.last_seen_at) >= datetime('now','localtime', ?)
		  AND (? IS NULL OR r.id != ?)
		ORDER BY datetime(rm.last_seen_at) DESC, r.id DESC
		LIMIT 1
	`).get(userId, `-${offlineSeconds} seconds`, excludeRoomId, excludeRoomId);
}

function getHostedOpenRoomForUser(db, userId, excludeRoomId = null) {
	return db.prepare(`
		SELECT id, code, status, host_user_id, soup_id
		FROM rooms
		WHERE host_user_id=?
		  AND status != 'closed'
		  AND (? IS NULL OR id != ?)
		ORDER BY datetime(last_activity_at) DESC, id DESC
		LIMIT 1
	`).get(userId, excludeRoomId, excludeRoomId);
}

function getCurrentRoomForUser(db, userId, excludeRoomId = null) {
	return getActiveRoomForUser(db, userId, excludeRoomId) || getHostedOpenRoomForUser(db, userId, excludeRoomId);
}

function buildRoomAiHistory(db, roomId, excludeQuestionId = null) {
	const rows = db.prepare(`
		SELECT content, answer
		FROM room_questions
		WHERE room_id=?
		  AND answer IS NOT NULL
		  AND (? IS NULL OR id != ?)
		ORDER BY id DESC
		LIMIT 30
	`).all(roomId, excludeQuestionId, excludeQuestionId).reverse();
	const history = [];
	for (const row of rows) {
		history.push({ role: "user", content: row.content });
		history.push({ role: "assistant", content: ANSWER_TEXT[row.answer] || "无关" });
	}
	return history;
}

async function answerRoomQuestionWithAi(db, room, question) {
	if (!isAiHostEnabled(room) || room.status !== "playing" || !room.soup_id) return null;
	if (!question || question.answer) return null;
	const soup = db.prepare(`SELECT * FROM soups WHERE id=?`).get(room.soup_id);
	if (!soup) return null;

	const result = await answerSoupQuestion({
		soup,
		userId: question.user_id,
		question: question.content,
		history: buildRoomAiHistory(db, room.id, question.id),
	});
	const answer = result.answerKey;
	db.prepare(`
		UPDATE room_questions
		SET status='answered', answer=?, answered_by=NULL, answered_at=${nowSqlExpr()}
		WHERE id=? AND room_id=?
	`).run(answer, question.id, room.id);
	db.prepare(`UPDATE room_events SET answer=? WHERE room_id=? AND question_id=? AND type='question'`).run(answer, room.id, question.id);
	const answerContent = `AI主持人回答「${question.content}」：${ANSWER_TEXT[answer]}`;
	const answerEvent = db.prepare(`SELECT id FROM room_events WHERE room_id=? AND question_id=? AND type='answer' ORDER BY id DESC LIMIT 1`).get(room.id, question.id);
	if (answerEvent) {
		db.prepare(`UPDATE room_events SET content=?, answer=?, user_id=NULL, created_at=${nowSqlExpr()} WHERE id=? AND room_id=?`).run(answerContent, answer, answerEvent.id, room.id);
		touchRoom(db, room.id);
	} else {
		addEvent(db, room.id, null, "answer", { content: answerContent, questionId: question.id, answer });
	}
	return answer;
}

function mapRoomState(room, user) {
	const db = getDb();
	const hostMode = isHost(room, user);
	const aiHostMode = isAiHostEnabled(room);
	const offlineSeconds = Number(config.ROOM_MEMBER_OFFLINE_SECONDS) || 35;
	const historyLimit = Number(config.ROOM_MAX_HISTORY) || 200;

	if (user) {
		db.prepare(`UPDATE room_members SET last_seen_at=${nowSqlExpr()} WHERE room_id=? AND user_id=?`).run(room.id, user.id);
	}

	const host = aiHostMode
		? { id: null, username: "AI主持人", isAi: true }
		: (room.host_user_id
			? db.prepare(`SELECT id, username FROM users WHERE id=?`).get(room.host_user_id)
			: null);

	const viewerBottomReveal = !!(aiHostMode && user && db.prepare(`
		SELECT 1 FROM room_bottom_reveals WHERE room_id=? AND user_id=?
	`).get(room.id, user.id));

	const members = db.prepare(`
		SELECT u.id, u.username, rm.role, rm.last_seen_at,
			CASE WHEN datetime(rm.last_seen_at) >= datetime('now','localtime', ?) THEN 1 ELSE 0 END AS online
		FROM room_members rm
		JOIN users u ON u.id=rm.user_id
		WHERE rm.room_id=?
		ORDER BY online DESC, rm.role='host' DESC, datetime(rm.last_seen_at) DESC
	`).all(`-${offlineSeconds} seconds`, room.id);

	let soup = null;
	if (room.soup_id) {
		const row = db.prepare(`
			SELECT
				s.*,
				CASE WHEN s.is_anonymous=1 THEN '匿名' ELSE COALESCE(u.username, 'Unknown') END AS author_name,
				(SELECT COUNT(1) FROM likes l WHERE l.soup_id=s.id) AS like_count,
				ROUND((SELECT AVG(r.score) FROM soup_ratings r WHERE r.soup_id=s.id), 1) AS rating_avg,
				(SELECT COUNT(1) FROM soup_ratings r WHERE r.soup_id=s.id) AS rating_count,
				(SELECT GROUP_CONCAT(t.name, '、') FROM soup_tags st JOIN tags t ON t.id=st.tag_id WHERE st.soup_id=s.id AND COALESCE(t.is_hidden,0)=0) AS tag_names
			FROM soups s
			LEFT JOIN users u ON u.id=s.author_id
			WHERE s.id=?
		`).get(room.soup_id);

		if (row) {
			soup = {
				id: row.id,
				title: row.title,
				surface: row.surface,
				authorName: row.author_name,
				likeCount: Number(row.like_count || 0),
				ratingAvg: row.rating_avg === null ? null : Number(row.rating_avg),
				ratingCount: Number(row.rating_count || 0),
				hasHostManual: !!row.has_host_manual,
				tags: String(row.tag_names || "").split("、").filter(Boolean),
			};
			if (hostMode || room.status === "finished" || viewerBottomReveal) soup.bottom = row.bottom;
			if (hostMode && row.has_host_manual) soup.hostManual = row.host_manual || "";
		}
	}

	const events = db.prepare(`
		SELECT e.*, u.username
		FROM room_events e
		LEFT JOIN users u ON u.id=e.user_id
		WHERE e.room_id=?
		ORDER BY e.id DESC
		LIMIT ?
	`).all(room.id, historyLimit).reverse().map((e) => ({
		id: e.id,
		type: e.type,
		username: e.username || "系统",
		content: e.content || "",
		questionId: e.question_id,
		answer: e.answer || null,
		answerText: e.answer ? ANSWER_TEXT[e.answer] : null,
		images: jsonParseArray(e.images_json),
		createdAt: e.created_at,
	}));

	const questions = db.prepare(`
		SELECT q.*, u.username AS username, au.username AS answered_by_name
		FROM room_questions q
		LEFT JOIN users u ON u.id=q.user_id
		LEFT JOIN users au ON au.id=q.answered_by
		WHERE q.room_id=?
		ORDER BY q.id ASC
	`).all(room.id).map((q) => ({
		id: q.id,
		username: q.username || "Unknown",
		content: q.content,
		status: q.status,
		answer: q.answer || null,
		answerText: q.answer ? ANSWER_TEXT[q.answer] : null,
		answeredByName: q.answered_by_name || null,
		createdAt: q.created_at,
		answeredAt: q.answered_at,
	}));

	const stickers = db.prepare(`
		SELECT id, url, COALESCE(original_name, '表情') AS name
		FROM room_stickers
		WHERE COALESCE(is_deleted, 0)=0
		ORDER BY id DESC
	`).all();

	const finishVote = aiHostMode ? getFinishVoteState(db, room.id) : null;

	return {
		room: {
			code: room.code,
			status: room.status,
			hostUserId: room.host_user_id || null,
			soupId: room.soup_id || null,
			aiHostEnabled: aiHostMode,
		},
		limits: {
			maxMembers: Number(config.ROOM_MAX_MEMBERS) || 12,
			maxActiveRooms: Number(config.ROOM_MAX_ACTIVE) || 5,
			maxHintImages: Number(config.ROOM_HINT_MAX_IMAGES) || 5,
		},
		viewer: user ? { id: user.id, username: user.username, isHost: hostMode, hasRevealedBottom: viewerBottomReveal } : null,
		host,
		members,
		finishVote,
		soup,
		events,
		questions,
		stickers,
	};
}

function getStatusText(status) {
	if (status === "playing") return "游玩中";
	if (status === "finished") return "已完结";
	if (status === "closed") return "已关闭";
	return "待开汤";
}

function renderRoomIndex(req, res) {
	cleanupRooms();
	const db = getDb();
	const offlineSeconds = Number(config.ROOM_MEMBER_OFFLINE_SECONDS) || 35;
	const maxRooms = Number(config.ROOM_MAX_ACTIVE) || 5;

	const rooms = db.prepare(`
		SELECT
			r.id, r.code, r.status, r.host_user_id, r.soup_id, r.ai_host_enabled,
			r.created_at, r.updated_at, r.last_activity_at,
			CASE WHEN COALESCE(r.ai_host_enabled,0)=1 THEN 'AI主持人' ELSE h.username END AS host_name,
			s.title AS soup_title,
			(
				SELECT COUNT(1)
				FROM room_members rm
				WHERE rm.room_id=r.id
				  AND datetime(rm.last_seen_at) >= datetime('now','localtime', ?)
			) AS online_count
		FROM rooms r
		LEFT JOIN users h ON h.id=r.host_user_id
		LEFT JOIN soups s ON s.id=r.soup_id
		WHERE r.status != 'closed'
		ORDER BY
			CASE r.status WHEN 'playing' THEN 0 WHEN 'finished' THEN 1 ELSE 2 END,
			datetime(r.last_activity_at) DESC,
			r.id DESC
	`).all(`-${offlineSeconds} seconds`).map((room) => ({
		...room,
		statusText: getStatusText(room.status),
		online_count: Number(room.online_count || 0),
	}));

	const currentRoom = req.session.user ? getCurrentRoomForUser(db, req.session.user.id) : null;

	res.render("rooms_index", {
		title: "海龟汤房间",
		rooms,
		activeCount: rooms.length,
		maxRooms,
		currentRoom,
		message: req.query.msg || null,
		currentUser: req.session.user,
	});
}

function createRoom(req, res) {
	cleanupRooms();
	const db = getDb();
	leaveOtherRoomsForUser(db, req.session.user, null);
	clearCurrentRoomSession(req);

	const activeCount = db.prepare(`SELECT COUNT(1) AS c FROM rooms WHERE status != 'closed'`).get().c;
	const maxRooms = Number(config.ROOM_MAX_ACTIVE) || 5;
	if (activeCount >= maxRooms) {
		return res.status(429).send(`当前开房间人数比较多，房间数量已达上限（${maxRooms} 个）。稍后再试试吧。`);
	}

	let code = generateRoomCode();
	while (db.prepare(`SELECT 1 FROM rooms WHERE code=?`).get(code)) code = generateRoomCode();

	const info = db.prepare(`INSERT INTO rooms (code) VALUES (?)`).run(code);
	const room = db.prepare(`SELECT * FROM rooms WHERE id=?`).get(info.lastInsertRowid);
	ensureMember(db, room, req.session.user, false);
	setCurrentRoomSession(req, room.id);
	addEvent(db, room.id, null, "system", { content: "房间已创建，待主持人选汤ing" });
	return res.redirect(`/rooms/${code}`);
}

function renderNewRoom(req, res) {
	return createRoom(req, res);
}

function renderRoom(req, res) {
	cleanupRooms();
	const db = getDb();
	const room = getRoomByCode(req.params.code);
	if (!room || room.status === "closed") return res.status(404).render("404", { title: "房间不存在" });

	try {
		ensureMember(db, room, req.session.user, true);
		setCurrentRoomSession(req, room.id);
	} catch (error) {
		if (error.roomCode) {
			return res.redirect(`/rooms/${error.roomCode}?msg=${encodeURIComponent(error.message)}`);
		}
		return res.status(error.statusCode || 500).send(error.message || "进入房间失败");
	}

	const tags = db.prepare(`
		SELECT id, name
		FROM tags
		WHERE COALESCE(is_hidden, 0)=0
		ORDER BY COALESCE(sort_order, id) ASC, id ASC
	`).all();

	res.render("room", {
		title: `海龟汤房间 ${room.code}`,
		room,
		tags,
		message: req.query.msg || null,
		currentUser: req.session.user,
		config: {
			maxMembers: Number(config.ROOM_MAX_MEMBERS) || 12,
			maxHintImages: Number(config.ROOM_HINT_MAX_IMAGES) || 5,
		},
	});
}

function getState(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const user = req.session.user;
	const db = getDb();
	const sessionRoomId = Number(req.session.currentRoomId || 0);
	if (sessionRoomId && sessionRoomId !== Number(room.id)) {
		const sessionRoom = db.prepare(`SELECT code FROM rooms WHERE id=? AND status != 'closed'`).get(sessionRoomId);
		if (sessionRoom) {
			return res.status(409).json({ message: "你已进入另一个房间，已自动退出当前房间", roomCode: sessionRoom.code });
		}
		clearCurrentRoomSession(req, sessionRoomId);
	}
	try {
		ensureMember(db, room, user, false);
		setCurrentRoomSession(req, room.id);
	} catch (error) {
		return res.status(error.statusCode || 500).json({
			message: error.message || "进入房间失败",
			roomCode: error.roomCode || null,
		});
	}
	return res.json(mapRoomState(room, user));
}

function sitHost(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const user = req.session.user;
	const db = getDb();
	if (isAiHostEnabled(room)) {
		return res.status(400).json({ message: "AI主持人正在主持本局，不能再坐主持人位" });
	}
	if (room.host_user_id && Number(room.host_user_id) !== Number(user.id)) {
		return res.status(400).json({ message: "主持人位已经有人啦" });
	}
	if (!room.host_user_id) {
		const hostedRoom = getHostedOpenRoomForUser(db, user.id, room.id);
		if (hostedRoom) {
			return res.status(400).json({ message: `你已经是房间 #${hostedRoom.code} 的主持人啦，一个人不能同时主持多个房间。` });
		}

		db.prepare(`UPDATE rooms SET host_user_id=?, updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()} WHERE id=? AND host_user_id IS NULL`).run(user.id, room.id);
		db.prepare(`UPDATE room_members SET role='host', last_seen_at=${nowSqlExpr()} WHERE room_id=? AND user_id=?`).run(room.id, user.id);
		addEvent(db, room.id, user.id, "system", { content: `${user.username} 坐到了主持人位` });
	}
	return res.json({ ok: true });
}

function leaveHost(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const user = req.session.user;
	const db = getDb();
	if (room.host_user_id && Number(room.host_user_id) === Number(user.id)) {
		db.prepare(`UPDATE rooms SET host_user_id=NULL, updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()} WHERE id=?`).run(room.id);
		db.prepare(`UPDATE room_members SET role='viewer', last_seen_at=${nowSqlExpr()} WHERE room_id=? AND user_id=?`).run(room.id, user.id);
		addEvent(db, room.id, user.id, "system", { content: `${user.username} 离开了主持人位` });
	}
	return res.json({ ok: true });
}

function presence(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const user = req.session.user;
	const db = getDb();
	const action = String(req.body.action || "heartbeat");
	if (action === "leave") {
		markRoomLeft(db, room, user, { addEvent: true });
		clearCurrentRoomSession(req, room.id);
		return res.json({ ok: true });
	}
	const sessionRoomId = Number(req.session.currentRoomId || 0);
	if (sessionRoomId && sessionRoomId !== Number(room.id)) {
		return res.json({ ok: true, ignored: true });
	}
	db.prepare(`UPDATE room_members SET last_seen_at=${nowSqlExpr()} WHERE room_id=? AND user_id=?`).run(room.id, user.id);
	setCurrentRoomSession(req, room.id);
	return res.json({ ok: true });
}

function searchSoups(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;

	const db = getDb();
	const user = req.session.user;
	const mode = String(req.query.mode || "human");
	if (mode === "ai") {
		if (!canUseAiHostPicker(room, user)) {
			return res.status(403).json({ message: "当前房间不能切换为 AI 主持人" });
		}
	} else if (!requireHost(req, res, room)) {
		return;
	}
	const q = String(req.query.q || "").trim();
	const tagsParam = String(req.query.tags || "").trim();
	const tagIds = tagsParam ? tagsParam.split(",").map((x) => Number(x)).filter(Number.isFinite) : [];
	const sort = String(req.query.sort || "").trim();

	let where = `WHERE ((s.visibility='public' AND s.status='approved') OR s.author_id=?)`;
	const params = [user.id];
	if (q) {
		where += ` AND (
			s.title LIKE ?
			OR s.surface LIKE ?
			OR (CASE WHEN s.is_anonymous=1 THEN '匿名' ELSE COALESCE(u.username, '') END) LIKE ?
		)`;
		const likeQ = `%${q}%`;
		params.push(likeQ, likeQ, likeQ);
	}
	if (tagIds.length > 0) {
		where += ` AND EXISTS (SELECT 1 FROM soup_tags st WHERE st.soup_id=s.id AND st.tag_id IN (${tagIds.map(() => "?").join(",")}))`;
		params.push(...tagIds);
	}
	let orderBy = "ORDER BY s.id DESC";
	if (sort === "hot_desc") orderBy = "ORDER BY like_count DESC, s.id DESC";
	if (sort === "hot_asc") orderBy = "ORDER BY like_count ASC, s.id DESC";
	if (sort === "rating_desc") orderBy = "ORDER BY COALESCE(rating_avg, 0) DESC, rating_count DESC, s.id DESC";
	if (sort === "rating_asc") orderBy = "ORDER BY COALESCE(rating_avg, 0) ASC, rating_count DESC, s.id DESC";

	const soups = db.prepare(`
		SELECT
			s.id, s.title, s.surface,
			(SELECT GROUP_CONCAT(t.name, '、') FROM soup_tags st JOIN tags t ON t.id=st.tag_id WHERE st.soup_id=s.id AND COALESCE(t.is_hidden,0)=0) AS tag_names,
			CASE WHEN s.is_anonymous=1 THEN '匿名' ELSE COALESCE(u.username, 'Unknown') END AS author_name,
			(SELECT COUNT(1) FROM likes l WHERE l.soup_id=s.id) AS like_count,
			ROUND((SELECT AVG(r.score) FROM soup_ratings r WHERE r.soup_id=s.id), 1) AS rating_avg,
			(SELECT COUNT(1) FROM soup_ratings r WHERE r.soup_id=s.id) AS rating_count
		FROM soups s
		LEFT JOIN users u ON u.id=s.author_id
		${where}
		${orderBy}
		LIMIT 30
	`).all(...params);
	return res.json({ soups });
}

function startSoup(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	if (!requireHost(req, res, room)) return;
	const db = getDb();
	const soupId = Number(req.body.soupId);
	if (!Number.isFinite(soupId)) return res.status(400).json({ message: "请选择海龟汤" });
	const soup = db.prepare(`SELECT * FROM soups WHERE id=? AND ((visibility='public' AND status='approved') OR author_id=?)`).get(soupId, req.session.user.id);
	if (!soup) return res.status(404).json({ message: "海龟汤不存在或不可开汤" });

	const tx = db.transaction(() => {
		db.prepare(`DELETE FROM room_events WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_questions WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_bottom_reveals WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_finish_votes WHERE room_id=?`).run(room.id);
		db.prepare(`UPDATE rooms SET soup_id=?, status='playing', ai_host_enabled=0, updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()} WHERE id=?`).run(soupId, room.id);
		addEvent(db, room.id, req.session.user.id, "start", { content: `开汤：《${soup.title}》` });
	});
	tx();
	return res.json({ ok: true });
}

function startAiSoup(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const db = getDb();
	const user = req.session.user;
	if (!canUseAiHostPicker(room, user)) {
		return res.status(403).json({ message: "当前房间不能切换为 AI 主持人" });
	}
	const soupId = Number(req.body.soupId);
	if (!Number.isFinite(soupId)) return res.status(400).json({ message: "请选择海龟汤" });
	const soup = db.prepare(`SELECT * FROM soups WHERE id=? AND ((visibility='public' AND status='approved') OR author_id=?)`).get(soupId, user.id);
	if (!soup) return res.status(404).json({ message: "海龟汤不存在或不可开汤" });

	const tx = db.transaction(() => {
		db.prepare(`DELETE FROM room_events WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_questions WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_bottom_reveals WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_finish_votes WHERE room_id=?`).run(room.id);
		db.prepare(`UPDATE room_members SET role='viewer' WHERE room_id=?`).run(room.id);
		db.prepare(`
			UPDATE rooms
			SET soup_id=?, status='playing', host_user_id=NULL, ai_host_enabled=1, updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()}
			WHERE id=?
		`).run(soupId, room.id);
		addEvent(db, room.id, user.id, "start", { content: `${user.username} 使用 AI 主持人开汤：《${soup.title}》` });
		addEvent(db, room.id, null, "system", { content: AI_HOST_TIP });
	});
	tx();
	return res.json({ ok: true });
}

async function postQuestion(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const user = req.session.user;
	const db = getDb();
	db.prepare(`UPDATE room_members SET last_seen_at=${nowSqlExpr()} WHERE room_id=? AND user_id=?`).run(room.id, user.id);
	const content = String(req.body.content || "").trim();
	if (room.status !== "playing") return res.status(400).json({ message: "开汤后才能提问" });
	if (!content) return res.status(400).json({ message: "问题不能为空" });
	if (content.length > 200) return res.status(400).json({ message: "问题最多 200 字" });
	const info = db.prepare(`INSERT INTO room_questions (room_id, user_id, content) VALUES (?, ?, ?)`).run(room.id, user.id, content);
	addEvent(db, room.id, user.id, "question", { content, questionId: info.lastInsertRowid });

	if (isAiHostEnabled(room)) {
		const question = db.prepare(`SELECT * FROM room_questions WHERE id=? AND room_id=?`).get(info.lastInsertRowid, room.id);
		try {
			await answerRoomQuestionWithAi(db, room, question);
		} catch (error) {
			console.error("[room-ai-host]", error.message);
			addEvent(db, room.id, null, "system", { content: `AI主持人暂时无法回答「${content}」，请稍后再问一次或换个问法。` });
			return res.status(error.statusCode || 502).json({ message: error.statusCode ? error.message : "AI主持人暂时无法回答，请稍后重试" });
		}
	}

	return res.json({ ok: true });
}

function answerQuestion(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	if (!requireHost(req, res, room)) return;
	const db = getDb();
	const questionId = Number(req.body.questionId);
	const answer = String(req.body.answer || "").trim();
	if (!ANSWER_VALUES.has(answer)) return res.status(400).json({ message: "回答只能是：是、否、部分是、无关" });
	const q = db.prepare(`SELECT * FROM room_questions WHERE id=? AND room_id=?`).get(questionId, room.id);
	if (!q) return res.status(404).json({ message: "问题不存在" });
	db.prepare(`
		UPDATE room_questions
		SET status='answered', answer=?, answered_by=?, answered_at=${nowSqlExpr()}
		WHERE id=? AND room_id=?
	`).run(answer, req.session.user.id, questionId, room.id);
	db.prepare(`UPDATE room_events SET answer=? WHERE room_id=? AND question_id=? AND type='question'`).run(answer, room.id, questionId);
	const answerContent = `回答「${q.content}」：${ANSWER_TEXT[answer]}`;
	const answerEvent = db.prepare(`SELECT id FROM room_events WHERE room_id=? AND question_id=? AND type='answer' ORDER BY id DESC LIMIT 1`).get(room.id, questionId);
	if (answerEvent) {
		db.prepare(`UPDATE room_events SET content=?, answer=?, user_id=?, created_at=${nowSqlExpr()} WHERE id=? AND room_id=?`).run(answerContent, answer, req.session.user.id, answerEvent.id, room.id);
		touchRoom(db, room.id);
	} else {
		addEvent(db, room.id, req.session.user.id, "answer", { content: answerContent, questionId, answer });
	}
	return res.json({ ok: true });
}

function deleteHistoryEvent(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	if (!requireHost(req, res, room)) return;
	const db = getDb();
	const eventId = Number(req.params.eventId);
	if (!Number.isFinite(eventId)) return res.status(400).json({ message: "参数错误" });
	const event = db.prepare(`SELECT * FROM room_events WHERE id=? AND room_id=?`).get(eventId, room.id);
	if (!event) return res.status(404).json({ message: "记录不存在" });
	if (event.type === "question") {
		const tx = db.transaction(() => {
			if (event.question_id) {
				db.prepare(`DELETE FROM room_events WHERE room_id=? AND question_id=?`).run(room.id, event.question_id);
				db.prepare(`DELETE FROM room_questions WHERE room_id=? AND id=?`).run(room.id, event.question_id);
			} else {
				db.prepare(`DELETE FROM room_events WHERE room_id=? AND id=?`).run(room.id, eventId);
			}
			touchRoom(db, room.id);
		});
		tx();
		return res.json({ ok: true });
	}
	if (event.type === "hint") {
		db.prepare(`DELETE FROM room_events WHERE room_id=? AND id=? AND type='hint'`).run(room.id, eventId);
		touchRoom(db, room.id);
		return res.json({ ok: true });
	}
	return res.status(400).json({ message: "只能删除提问或提示记录" });
}

function postHint(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	if (!requireHost(req, res, room)) return;
	const db = getDb();
	if (room.status !== "playing") return res.status(400).json({ message: "开汤后才能提示" });
	const content = String(req.body.content || "").trim();
	const images = (req.files || []).map((f) => `/uploads/room-hints/${f.filename}`);
	if (!content && images.length === 0) return res.status(400).json({ message: "提示内容或图片至少填一个" });
	if (content.length > 300) return res.status(400).json({ message: "提示最多 300 字" });
	addEvent(db, room.id, req.session.user.id, "hint", { content, imagesJson: JSON.stringify(images) });
	return res.json({ ok: true });
}

function postChat(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const user = req.session.user;
	const db = getDb();
	const content = String(req.body.content || "").trim();
	if (!content) return res.status(400).json({ message: "内容不能为空" });
	if (content.length > 300) return res.status(400).json({ message: "讨论内容最多 300 字" });
	addEvent(db, room.id, user.id, "chat", { content });
	return res.json({ ok: true });
}

function postSticker(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const user = req.session.user;
	const db = getDb();
	const stickerId = Number(req.body.stickerId);
	if (!Number.isFinite(stickerId)) return res.status(400).json({ message: "请选择表情" });

	const sticker = db.prepare(`
		SELECT id, url
		FROM room_stickers
		WHERE id=? AND COALESCE(is_deleted, 0)=0
	`).get(stickerId);
	if (!sticker) return res.status(404).json({ message: "表情不存在或已下架" });

	addEvent(db, room.id, user.id, "sticker", { content: sticker.url });
	return res.json({ ok: true });
}

function revealAiBottom(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const user = req.session.user;
	const db = getDb();
	db.prepare(`UPDATE room_members SET last_seen_at=${nowSqlExpr()} WHERE room_id=? AND user_id=?`).run(room.id, user.id);
	if (!isAiHostEnabled(room) || room.status !== "playing" || !room.soup_id) {
		return res.status(400).json({ message: "当前房间不是 AI 主持人模式" });
	}
	const soup = db.prepare(`SELECT id, bottom FROM soups WHERE id=?`).get(room.soup_id);
	if (!soup) return res.status(404).json({ message: "海龟汤不存在" });
	const existed = db.prepare(`SELECT 1 FROM room_bottom_reveals WHERE room_id=? AND user_id=?`).get(room.id, user.id);
	db.prepare(`
		INSERT OR IGNORE INTO room_bottom_reveals (room_id, user_id)
		VALUES (?, ?)
	`).run(room.id, user.id);
	if (!existed) addEvent(db, room.id, user.id, "reveal", { content: `${user.username}查看了汤底` });
	return res.json({ ok: true, bottom: soup.bottom });
}

function voteFinishAiRoom(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const user = req.session.user;
	const db = getDb();
	db.prepare(`UPDATE room_members SET last_seen_at=${nowSqlExpr()} WHERE room_id=? AND user_id=?`).run(room.id, user.id);
	if (!isAiHostEnabled(room) || room.status !== "playing" || !room.soup_id) {
		return res.status(400).json({ message: "当前房间不是 AI 主持人模式" });
	}
	const vote = String(req.body.vote || "yes").trim() === "no" ? "no" : "yes";
	db.prepare(`
		INSERT INTO room_finish_votes (room_id, user_id, vote)
		VALUES (?, ?, ?)
		ON CONFLICT(room_id, user_id) DO UPDATE SET vote=excluded.vote, updated_at=${nowSqlExpr()}
	`).run(room.id, user.id, vote);

	const voteState = getFinishVoteState(db, room.id);
	if (voteState.passed) {
		db.prepare(`UPDATE rooms SET status='finished', updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()} WHERE id=?`).run(room.id);
		addEvent(db, room.id, null, "finish", { content: `完结撒花投票通过（${voteState.yesCount}/${voteState.onlineCount}），汤底已公开` });
		return res.json({ ok: true, finished: true, vote: voteState });
	}

	addEvent(db, room.id, user.id, "vote", {
		content: `${user.username}${vote === "yes" ? "同意" : "暂不同意"}完结撒花（当前 ${voteState.yesCount}/${voteState.onlineCount}，需超过半数）`,
	});
	return res.json({ ok: true, finished: false, vote: voteState });
}

function resetAiRoom(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	const db = getDb();
	if (!isAiHostEnabled(room) || room.status !== "finished") {
		return res.status(400).json({ message: "只有 AI 主持人完结后才能结束本局" });
	}
	const tx = db.transaction(() => {
		db.prepare(`DELETE FROM room_events WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_questions WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_bottom_reveals WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_finish_votes WHERE room_id=?`).run(room.id);
		db.prepare(`UPDATE room_members SET role='viewer' WHERE room_id=?`).run(room.id);
		db.prepare(`UPDATE rooms SET soup_id=NULL, status='waiting', host_user_id=NULL, ai_host_enabled=0, updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()} WHERE id=?`).run(room.id);
	});
	tx();
	return res.json({ ok: true });
}

function finishSoup(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	if (!requireHost(req, res, room)) return;
	if (!room.soup_id) return res.status(400).json({ message: "还没有开汤" });
	const db = getDb();
	db.prepare(`UPDATE rooms SET status='finished', updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()} WHERE id=?`).run(room.id);
	addEvent(db, room.id, req.session.user.id, "finish", { content: "完结撒花，汤底已公开" });
	return res.json({ ok: true });
}

function resetRoom(req, res) {
	const room = requireRoom(req, res);
	if (!room) return;
	if (!requireHost(req, res, room)) return;
	const db = getDb();
	const tx = db.transaction(() => {
		db.prepare(`DELETE FROM room_events WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_questions WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_bottom_reveals WHERE room_id=?`).run(room.id);
		db.prepare(`DELETE FROM room_finish_votes WHERE room_id=?`).run(room.id);
		db.prepare(`UPDATE rooms SET soup_id=NULL, status='waiting', ai_host_enabled=0, updated_at=${nowSqlExpr()}, last_activity_at=${nowSqlExpr()} WHERE id=?`).run(room.id);
		addEvent(db, room.id, req.session.user.id, "reset", { content: "主持人结束了本局，待主持人选汤ing" });
	});
	tx();
	return res.json({ ok: true });
}

module.exports = {
	renderRoomIndex,
	createRoom,
	renderNewRoom,
	renderRoom,
	getState,
	sitHost,
	leaveHost,
	presence,
	searchSoups,
	startSoup,
	startAiSoup,
	postQuestion,
	answerQuestion,
	deleteHistoryEvent,
	postHint,
	postChat,
	postSticker,
	revealAiBottom,
	voteFinishAiRoom,
	resetAiRoom,
	finishSoup,
	resetRoom,
};
