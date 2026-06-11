const express = require("express");

const { requireLogin } = require("../middlewares/auth");
const { renderCreate, postCreate } = require("../controllers/createSoupController");
const { renderSoupDetail, getComments, postComment, deleteComment, togglePinComment, postRating, toggleFavorite } = require("../controllers/soupController");
const { askFacilitator } = require("../controllers/facilitatorController");
const { getDb } = require("../db/database");
const { markRevealed, hasRevealed } = require("../middlewares/reveal");
const { canAccessSoup } = require("../utils/access");

const router = express.Router();

router.get("/create", requireLogin, renderCreate);
router.post("/create", requireLogin, postCreate);

// 详情页
router.get("/:id", renderSoupDetail);

// 翻到背面时调用：记录“已查看汤底”
router.post("/:id/reveal", (req, res) => {
	const soupId = Number(req.params.id);
	if (!Number.isFinite(soupId)) return res.status(400).json({ message: "参数错误" });
	markRevealed(req, soupId);
	return res.json({ ok: true });
});

/** 点赞接口：必须已看汤底；公开汤/私密可访问汤都可点赞 */
router.post("/:id/like", (req, res) => {
	const db = getDb();
	const soupId = Number(req.params.id);
	if (!Number.isFinite(soupId)) return res.status(400).json({ message: "参数错误" });

	if (!hasRevealed(req, soupId)) {
		return res.status(403).json({ message: "请先查看汤底，再点赞" });
	}

	const soup = db.prepare(`SELECT * FROM soups WHERE id=?`).get(soupId);
	if (!soup || !canAccessSoup(req, soup)) {
		return res.status(404).json({ message: "海龟汤不存在或不可点赞" });
	}

	const user = req.session.user || null;
	const visitorToken = req.cookies.visitor_token;

	try {
		if (user) {
			db.prepare(`INSERT INTO likes (soup_id, user_id, visitor_token) VALUES (?, ?, NULL)`).run(soupId, user.id);
		} else {
			db.prepare(`INSERT INTO likes (soup_id, user_id, visitor_token) VALUES (?, NULL, ?)`).run(soupId, visitorToken);
		}
	} catch (e) {
		return res.status(400).json({ message: "你已经点过赞了" });
	}

	const likeCount = db.prepare(`SELECT COUNT(1) AS c FROM likes WHERE soup_id = ?`).get(soupId).c;
	return res.json({ likeCount });
});

// 拉取留言（必须先查看汤底，防剧透）
router.get("/:id/comments", getComments);

// 评分：登录用户每碗汤保留一条评分，重复评分会覆盖
router.post("/:id/rating", postRating);

// 收藏/取消收藏：登录用户每碗汤一条收藏记录
router.post("/:id/favorite", requireLogin, toggleFavorite);

// 发布留言/回复
router.post("/:id/comments", postComment);

// 删除自己的留言/回复
router.post("/:id/comments/:commentId/delete", requireLogin, deleteComment);

// 海龟汤发布者置顶/取消置顶留言
router.post("/:id/comments/:commentId/pin", requireLogin, togglePinComment);

// AI 主持人
router.post("/:id/ask", askFacilitator);

module.exports = router;
