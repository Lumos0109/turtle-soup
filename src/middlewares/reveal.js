/**
 * 记录/检查“是否看过汤底”
 * - 游客：写进 session
 * - 登录用户：同时写进数据库 soup_reveals，供首页“隐藏已读”筛选使用
 */

const { getDb } = require("../db/database");

function markRevealed(req, soupId) {
	if (!req.session.revealedSoups) req.session.revealedSoups = {};
	req.session.revealedSoups[String(soupId)] = 1;

	const user = req.session.user || null;
	if (user && Number.isFinite(Number(soupId))) {
		try {
			const db = getDb();
			db.prepare(`
				INSERT OR IGNORE INTO soup_reveals (user_id, soup_id)
				VALUES (?, ?)
			`).run(user.id, Number(soupId));
		} catch (e) {
			// 不影响翻面主流程；数据库异常时仍保留 session 记录
			console.error("记录已查看汤底失败:", e);
		}
	}
}

function hasRevealed(req, soupId) {
	if (req.session.revealedSoups && req.session.revealedSoups[String(soupId)] === 1) {
		return true;
	}

	const user = req.session.user || null;
	if (user && Number.isFinite(Number(soupId))) {
		try {
			const db = getDb();
			const row = db.prepare(`
				SELECT 1 FROM soup_reveals
				WHERE user_id = ? AND soup_id = ?
			`).get(user.id, Number(soupId));

			return !!row;
		} catch (e) {
			console.error("读取已查看汤底失败:", e);
		}
	}

	return false;
}

module.exports = { markRevealed, hasRevealed };