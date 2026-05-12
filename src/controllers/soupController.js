const { getDb } = require("../db/database");
const { hasRevealed } = require("../middlewares/reveal");
const { canAccessSoup, allowSoupInSession } = require("../utils/access");
const { createNotification } = require("../utils/notifications");

/**
 * 读取留言列表。
 * - is_deleted=1 的留言会保留楼层，但显示“该留言已删除”
 * - is_pinned=1 的留言会优先显示
 */
function loadComments(db, soupId) {
	return db.prepare(`
		SELECT
			c.id,
			c.soup_id,
			c.user_id,
			c.parent_id,
			c.content,
			c.created_at,
			COALESCE(c.is_deleted, 0) AS is_deleted,
			COALESCE(c.is_pinned, 0) AS is_pinned,
			c.pinned_at,
			CASE
				WHEN COALESCE(c.is_deleted, 0)=1 THEN '已删除'
				ELSE COALESCE(u.username, 'Unknown')
			END AS username,
			CASE
				WHEN COALESCE(pc.is_deleted, 0)=1 THEN '已删除'
				ELSE pu.username
			END AS parent_username
		FROM comments c
		LEFT JOIN users u ON u.id = c.user_id
		LEFT JOIN comments pc ON pc.id = c.parent_id
		LEFT JOIN users pu ON pu.id = pc.user_id
		WHERE c.soup_id = ?
		ORDER BY
			COALESCE(c.is_pinned, 0) DESC,
			CASE WHEN COALESCE(c.is_pinned, 0)=1 THEN datetime(COALESCE(c.pinned_at, c.created_at)) END DESC,
			COALESCE(c.parent_id, c.id) ASC,
			c.parent_id IS NOT NULL ASC,
			c.id ASC
	`).all(soupId);

}

function loadRatingStats(db, soupId) {
	const row = db.prepare(`
		SELECT
			ROUND(AVG(score), 1) AS rating_avg,
			COUNT(1) AS rating_count
		FROM soup_ratings
		WHERE soup_id = ?
	`).get(soupId);

	return {
		ratingAvg: row && row.rating_avg !== null ? Number(row.rating_avg) : null,
		ratingCount: row ? Number(row.rating_count || 0) : 0,
	};
}

/** 渲染海龟汤详情页：汤面/汤底 + 点赞数 + 留言列表 */
function renderSoupDetail(req, res) {
	const db = getDb();
	const soupId = Number(req.params.id);

	const soup = db.prepare(`
		SELECT
			s.*,
			CASE
				WHEN s.is_anonymous = 1 THEN '匿名'
				ELSE COALESCE(u.username, 'Unknown')
			END AS author_name,
			(SELECT COUNT(1) FROM likes l WHERE l.soup_id = s.id) AS like_count,
			ROUND((SELECT AVG(r.score) FROM soup_ratings r WHERE r.soup_id = s.id), 1) AS rating_avg,
			(SELECT COUNT(1) FROM soup_ratings r WHERE r.soup_id = s.id) AS rating_count,
			sc.code AS share_code
		FROM soups s
		LEFT JOIN users u ON u.id = s.author_id
		LEFT JOIN share_codes sc ON sc.soup_id = s.id
		WHERE s.id = ?
	`).get(soupId);

	if (!soup) return res.status(404).render("404", { title: "海龟汤不存在" });
	if (!canAccessSoup(req, soup)) return res.status(404).render("404", { title: "海龟汤不存在" });

	const revealed = hasRevealed(req, soupId);
	let comments = [];
	let commentCount = null;

	if (revealed) {
		comments = loadComments(db, soupId);
		commentCount = comments.length;
	}

	const currentUser = req.session.user || null;
	const visitorToken = req.cookies.visitor_token;
	let hasLiked = false;

	if (currentUser) {
		const row = db.prepare(`SELECT 1 FROM likes WHERE soup_id = ? AND user_id = ?`).get(soupId, currentUser.id);
		hasLiked = !!row;
	} else if (visitorToken) {
		const row = db.prepare(`SELECT 1 FROM likes WHERE soup_id = ? AND visitor_token = ?`).get(soupId, visitorToken);
		hasLiked = !!row;
	}

	const soupTags = db.prepare(`
		SELECT t.id, t.name
		FROM soup_tags st
		JOIN tags t ON t.id = st.tag_id
		WHERE st.soup_id = ? AND COALESCE(t.is_hidden, 0)=0
		ORDER BY COALESCE(t.sort_order, t.id) ASC, t.id ASC
	`).all(soupId);

	let currentUserRating = null;
	if (currentUser) {
		const ratingRow = db.prepare(`SELECT score FROM soup_ratings WHERE soup_id = ? AND user_id = ?`).get(soupId, currentUser.id);
		currentUserRating = ratingRow ? Number(ratingRow.score) : null;
	}

	res.render("soup_detail", {
		title: soup.title,
		soup,
		comments,
		commentCount,
		revealed,
		hasLiked,
		currentUserRating,
		soupTags,
		commentError: null,
	});
}

/** 拉取留言：必须已看汤底，用于前端翻转后加载，避免未翻转前在 HTML 里泄露留言。 */
function getComments(req, res) {
	const db = getDb();
	const soupId = Number(req.params.id);
	if (!Number.isFinite(soupId)) return res.status(400).json({ message: "参数错误" });

	if (!hasRevealed(req, soupId)) {
		return res.status(403).json({ message: "请先查看汤底，再查看留言" });
	}

	const soup = db.prepare(`SELECT * FROM soups WHERE id=?`).get(soupId);
	if (!soup || !canAccessSoup(req, soup)) {
		return res.status(404).json({ message: "海龟汤不存在或不可查看留言" });
	}

	const comments = loadComments(db, soupId);
	return res.json({
		commentCount: comments.length,
		comments,
		canPost: !!(req.session && req.session.user),
		currentUserId: req.session.user ? req.session.user.id : null,
		soupAuthorId: soup.author_id || null,
	});
}

/** 提交留言/回复：必须登录 + 必须已看汤底 */
function postComment(req, res) {
	const db = getDb();
	const soupId = Number(req.params.id);
	const user = req.session.user;

	if (!user) {
		const nextUrl = encodeURIComponent(`/soups/${soupId}#discussion`);
		return res.redirect(`/auth/login?next=${nextUrl}`);
	}

	if (!Number.isFinite(soupId)) return res.status(400).send("参数错误");
	if (!hasRevealed(req, soupId)) return res.status(403).send("请先查看汤底，再留言");

	const content = (req.body.content || "").trim();
	let parentId = Number(req.body.parent_id || 0);
	if (!Number.isFinite(parentId) || parentId <= 0) parentId = null;

	if (!content) return res.redirect(`/soups/${soupId}#discussion`);
	if (content.length > 300) return res.redirect(`/soups/${soupId}#discussion`);

	const soup = db.prepare(`SELECT * FROM soups WHERE id = ?`).get(soupId);
	if (!soup) return res.status(404).render("404", { title: "海龟汤不存在" });
	if (!canAccessSoup(req, soup)) return res.status(404).render("404", { title: "海龟汤不存在" });

	let parent = null;
	if (parentId) {
		parent = db.prepare(`
			SELECT c.*, COALESCE(c.is_deleted, 0) AS is_deleted, u.username AS username
			FROM comments c
			LEFT JOIN users u ON u.id=c.user_id
			WHERE c.id=? AND c.soup_id=?
		`).get(parentId, soupId);
		if (!parent || parent.is_deleted === 1) parentId = null;
	}

	const info = db.prepare(`
		INSERT INTO comments (soup_id, user_id, parent_id, content)
		VALUES (?, ?, ?, ?)
	`).run(soupId, user.id, parentId, content);

	const commentId = info.lastInsertRowid;
	const linkUrl = `/soups/${soupId}#discussion`;
	const notified = new Set();

	// 1) 自己的海龟汤底下有新留言/回复：通知作者（自己给自己留言不通知）
	if (soup.author_id && soup.author_id !== user.id) {
		notified.add(soup.author_id);
		createNotification({
			userId: soup.author_id,
			type: "soup_comment",
			title: parentId ? "你的海龟汤有新回复" : "你的海龟汤有新留言",
			content: `${user.username} 在《${soup.title}》下${parentId ? "回复了留言" : "发表了留言"}：${content.slice(0, 80)}`,
			linkUrl,
			actorUserId: user.id,
			soupId,
			commentId,
		});
	}

	// 2) 自己的留言被回复：通知被回复的留言作者（避免重复通知）
	if (parent && parent.user_id && parent.user_id !== user.id && !notified.has(parent.user_id)) {
		createNotification({
			userId: parent.user_id,
			type: "comment_reply",
			title: "你的留言收到回复",
			content: `${user.username} 回复了你在《${soup.title}》下的留言：${content.slice(0, 80)}`,
			linkUrl,
			actorUserId: user.id,
			soupId,
			commentId,
		});
	}

	return res.redirect(`/soups/${soupId}#discussion`);
}

/** 删除自己的留言/回复：软删除，保留讨论楼层结构。 */
function deleteComment(req, res) {
	const db = getDb();
	const user = req.session.user;
	const soupId = Number(req.params.id);
	const commentId = Number(req.params.commentId);

	if (!user) return res.status(401).json({ message: "请先登录" });
	if (!Number.isFinite(soupId) || !Number.isFinite(commentId)) return res.status(400).send("参数错误");

	const soup = db.prepare(`SELECT * FROM soups WHERE id=?`).get(soupId);
	if (!soup || !canAccessSoup(req, soup)) return res.status(404).render("404", { title: "海龟汤不存在" });

	const comment = db.prepare(`SELECT * FROM comments WHERE id=? AND soup_id=?`).get(commentId, soupId);
	if (!comment) return res.redirect(`/soups/${soupId}#discussion`);
	if (comment.user_id !== user.id) return res.status(403).send("只能删除自己的留言");

	db.prepare(`
		UPDATE comments
		SET is_deleted=1, is_pinned=0, pinned_at=NULL, content=''
		WHERE id=? AND soup_id=? AND user_id=?
	`).run(commentId, soupId, user.id);

	return res.redirect(`/soups/${soupId}#discussion`);
}

/** 置顶/取消置顶留言：只有海龟汤发布者可以操作，同一碗汤同时只保留一条置顶。 */
function togglePinComment(req, res) {
	const db = getDb();
	const user = req.session.user;
	const soupId = Number(req.params.id);
	const commentId = Number(req.params.commentId);

	if (!user) return res.status(401).json({ message: "请先登录" });
	if (!Number.isFinite(soupId) || !Number.isFinite(commentId)) return res.status(400).send("参数错误");

	const soup = db.prepare(`SELECT * FROM soups WHERE id=?`).get(soupId);
	if (!soup || !canAccessSoup(req, soup)) return res.status(404).render("404", { title: "海龟汤不存在" });
	if (soup.author_id !== user.id) return res.status(403).send("只有海龟汤发布者可以置顶留言");

	const comment = db.prepare(`
		SELECT id, COALESCE(is_pinned, 0) AS is_pinned, COALESCE(is_deleted, 0) AS is_deleted
		FROM comments
		WHERE id=? AND soup_id=?
	`).get(commentId, soupId);

	if (!comment || comment.is_deleted === 1) return res.redirect(`/soups/${soupId}#discussion`);

	const tx = db.transaction(() => {
		if (comment.is_pinned === 1) {
			db.prepare(`UPDATE comments SET is_pinned=0, pinned_at=NULL WHERE id=? AND soup_id=?`).run(commentId, soupId);
		} else {
			db.prepare(`UPDATE comments SET is_pinned=0, pinned_at=NULL WHERE soup_id=?`).run(soupId);
			db.prepare(`UPDATE comments SET is_pinned=1, pinned_at=datetime('now','localtime') WHERE id=? AND soup_id=?`).run(commentId, soupId);
		}
	});
	tx();

	return res.redirect(`/soups/${soupId}#discussion`);
}


function postRating(req, res) {
	const db = getDb();
	const soupId = Number(req.params.id);
	const user = req.session.user;

	if (!user) return res.status(401).json({ message: "请先登录后再打分" });
	if (!Number.isFinite(soupId)) return res.status(400).json({ message: "参数错误" });

	const score = Number(req.body.score);
	if (![2, 4, 6, 8, 10].includes(score)) {
		return res.status(400).json({ message: "评分只能是 2、4、6、8、10 分" });
	}

	const soup = db.prepare(`SELECT * FROM soups WHERE id=?`).get(soupId);
	if (!soup || !canAccessSoup(req, soup)) {
		return res.status(404).json({ message: "海龟汤不存在或不可打分" });
	}

	const existed = db.prepare(`SELECT score FROM soup_ratings WHERE soup_id=? AND user_id=?`).get(soupId, user.id);

	if (existed) {
		db.prepare(`
			UPDATE soup_ratings
			SET score=?, updated_at=datetime('now','localtime')
			WHERE soup_id=? AND user_id=?
		`).run(score, soupId, user.id);
	} else {
		db.prepare(`
			INSERT INTO soup_ratings (soup_id, user_id, score)
			VALUES (?, ?, ?)
		`).run(soupId, user.id, score);
	}

	const stats = loadRatingStats(db, soupId);

	if (soup.author_id && soup.author_id !== user.id) {
		createNotification({
			userId: soup.author_id,
			type: "soup_rating",
			title: existed ? "你的海龟汤评分被更新" : "你的海龟汤收到新评分",
			content: `${user.username} 给《${soup.title}》打了 ${score} 分。`,
			linkUrl: `/soups/${soupId}#rating-summary`,
			actorUserId: user.id,
			soupId,
		});
	}

	return res.json({
		ok: true,
		userScore: score,
		hadRatedBefore: !!existed,
		ratingAvg: stats.ratingAvg,
		ratingCount: stats.ratingCount,
	});
}

function renderShareExpired(req, res) {
	return res.status(410).render("share_expired", { title: "分享码已过期" });
}

function redeemShareCode(req, res) {
	const db = getDb();
	const code = (req.params.code || "").trim();
	if (!code) return renderShareExpired(req, res);

	const row = db.prepare(`SELECT soup_id, expires_at FROM share_codes WHERE code = ?`).get(code);
	if (!row) return renderShareExpired(req, res);

	const expiresAt = new Date(row.expires_at).getTime();
	if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return renderShareExpired(req, res);

	allowSoupInSession(req, row.soup_id);
	return res.redirect(`/soups/${row.soup_id}`);
}

module.exports = {
	renderSoupDetail,
	getComments,
	postComment,
	deleteComment,
	togglePinComment,
	postRating,
	redeemShareCode,
};
