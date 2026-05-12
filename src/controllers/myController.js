const { getDb } = require("../db/database");
const { createOrReplaceShareCode, isShareExpired } = require("../utils/shareCode");

/**
 * 我的汤库控制器
 * 功能：
 * - 查看自己上传的全部海龟汤
 * - 重新生成私密分享码
 * - 编辑自己的海龟汤：草稿 / 私密 / 公开重提审核
 * - 删除自己的海龟汤
 */

function statusText(soup) {
	if (soup.visibility === "public" && soup.status === "pending") return "待审核";
	if (soup.visibility === "public" && soup.status === "approved") return "已公开";
	if (soup.visibility === "public" && soup.status === "rejected") return "已驳回";
	if (soup.visibility === "private" && soup.status === "draft") return "草稿";
	if (soup.visibility === "private") return "私密";
	return soup.status;
}

function editModeText(soup) {
	if (soup.visibility === "public" && soup.status === "approved") {
		return "已公开内容修改后会重新进入待审核，审核通过前不会显示在公开汤池。";
	}
	if (soup.visibility === "public" && soup.status === "rejected") {
		return "修改后可重新提交审核。";
	}
	if (soup.visibility === "public" && soup.status === "pending") {
		return "当前正在待审核，修改后仍会保持待审核状态。";
	}
	if (soup.visibility === "private" && soup.status === "draft") {
		return "草稿可继续保存，也可以公开发布或改为私密分享。";
	}
	if (soup.visibility === "private") {
		return "私密汤修改后会继续保持私密分享，也可以改为公开发布或草稿。";
	}
	return "你可以编辑这碗海龟汤。";
}

function normalizeTagIds(raw) {
	let tagIds = raw || [];
	if (!Array.isArray(tagIds)) tagIds = [tagIds];
	return tagIds.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

function loadSoupForOwner(db, soupId, userId) {
	return db.prepare(`
		SELECT *
		FROM soups
		WHERE id=? AND author_id=?
	`).get(soupId, userId);
}

function loadEditTags(db, soupId) {
	return db.prepare(`
		SELECT
			t.id,
			t.name,
			COALESCE(t.is_hidden, 0) AS is_hidden
		FROM tags t
		WHERE COALESCE(t.is_hidden, 0)=0
			OR EXISTS (
				SELECT 1 FROM soup_tags st
				WHERE st.soup_id=? AND st.tag_id=t.id
			)
		ORDER BY COALESCE(t.sort_order, t.id) ASC, t.id ASC
	`).all(soupId);
}

function loadSelectedTagIds(db, soupId) {
	return db.prepare(`SELECT tag_id FROM soup_tags WHERE soup_id=?`).all(soupId).map((x) => x.tag_id);
}

function renderMySoups(req, res) {
	const db = getDb();
	const user = req.session.user;

	const soups = db.prepare(`
		SELECT
			s.*,
			sc.code AS share_code,
			sc.expires_at AS share_expires_at,
			(SELECT COUNT(1) FROM likes l WHERE l.soup_id=s.id) AS like_count
		FROM soups s
		LEFT JOIN share_codes sc ON sc.soup_id=s.id
		WHERE s.author_id=?
		ORDER BY s.id DESC
	`).all(user.id);

	const rows = soups.map((s) => ({
		...s,
		status_text: statusText(s),
		share_expired: s.share_expires_at ? isShareExpired(s.share_expires_at) : false,
	}));

	res.render("my", {
		title: "我的汤库",
		soups: rows,
		msg: req.query.msg || null,
	});
}

function regenerateShareCode(req, res) {
	const db = getDb();
	const user = req.session.user;
	const soupId = Number(req.params.id);

	if (!Number.isFinite(soupId)) {
		return res.redirect("/my?msg=参数错误");
	}

	const soup = loadSoupForOwner(db, soupId, user.id);

	if (!soup) {
		return res.redirect("/my?msg=没有找到这碗汤");
	}

	if (!(soup.visibility === "private" && soup.status === "approved")) {
		return res.redirect("/my?msg=只有私密分享汤可以重新生成分享码");
	}

	createOrReplaceShareCode(db, soupId);

	return res.redirect("/my?msg=分享码已重新生成");
}

function renderEditMySoup(req, res) {
	const db = getDb();
	const user = req.session.user;
	const soupId = Number(req.params.id);

	if (!Number.isFinite(soupId)) {
		return res.redirect("/my?msg=参数错误");
	}

	const soup = loadSoupForOwner(db, soupId, user.id);
	if (!soup) {
		return res.redirect("/my?msg=没有找到这碗汤");
	}

	const tags = loadEditTags(db, soupId);
	const selectedTagIds = loadSelectedTagIds(db, soupId);

	res.render("my_edit", {
		title: "编辑海龟汤",
		soup,
		statusText: statusText(soup),
		editHint: editModeText(soup),
		tags,
		selectedTagIds,
		error: null,
	});
}

function postEditMySoup(req, res) {
	const db = getDb();
	const user = req.session.user;
	const soupId = Number(req.params.id);

	if (!Number.isFinite(soupId)) {
		return res.redirect("/my?msg=参数错误");
	}

	const soup = loadSoupForOwner(db, soupId, user.id);
	if (!soup) {
		return res.redirect("/my?msg=没有找到这碗汤");
	}

	const title = (req.body.title || "").trim();
	const surface = (req.body.surface || "").trim();
	const bottom = (req.body.bottom || "").trim();
	const hasHostManual = req.body.has_host_manual === "1" ? 1 : 0;
	const hostManual = hasHostManual ? (req.body.host_manual || "").trim() : "";
	const isAnonymous = req.body.is_anonymous === "1" ? 1 : 0;
	const action = (req.body.action || "public").trim();

	const tags = loadEditTags(db, soupId);
	const selectedTagIds = loadSelectedTagIds(db, soupId);

	function renderError(message) {
		return res.status(400).render("my_edit", {
			title: "编辑海龟汤",
			soup: { ...soup, title, surface, bottom, has_host_manual: hasHostManual, host_manual: hostManual, is_anonymous: isAnonymous },
			statusText: statusText(soup),
			editHint: editModeText(soup),
			tags,
			selectedTagIds,
			error: message,
		});
	}

	if (!title || !surface || !bottom) {
		return renderError("标题、汤面、汤底不能为空。");
	}

	if (title.length > 60) {
		return renderError("标题最多 60 字。");
	}

	if (surface.length > 1000 || bottom.length > 2000) {
		return renderError("汤面最多 1000 字，汤底最多 2000 字。");
	}

	if (hasHostManual && !hostManual) {
		return renderError("勾选主持人手册后，请填写主持人手册内容。");
	}

	if (hostManual.length > 2000) {
		return renderError("主持人手册最多 2000 字。");
	}

	let nextVisibility = "public";
	let nextStatus = "pending";
	let msg = "已提交审核";

	if (action === "draft") {
		nextVisibility = "private";
		nextStatus = "draft";
		msg = "草稿已保存";
	} else if (action === "private") {
		nextVisibility = "private";
		nextStatus = "approved";
		msg = "私密分享已保存";
	} else {
		// 公开发布/重新提交：不管原先是否已公开，编辑后都重新进入审核，避免绕过审核改内容
		nextVisibility = "public";
		nextStatus = "pending";
		msg = soup.status === "approved" ? "修改已提交审核，审核通过前暂不显示在公开汤池" : "已提交审核";
	}

	let tagIds = normalizeTagIds(req.body.tagIds);
	const allowedTagIds = new Set(tags.map((t) => t.id));
	tagIds = tagIds.filter((id) => allowedTagIds.has(id));

	const tx = db.transaction(() => {
		db.prepare(`
			UPDATE soups
			SET title=?, surface=?, bottom=?, has_host_manual=?, host_manual=?, is_anonymous=?, visibility=?, status=?, review_note=NULL,
				updated_at=datetime('now','localtime')
			WHERE id=? AND author_id=?
		`).run(title, surface, bottom, hasHostManual, hostManual || null, isAnonymous, nextVisibility, nextStatus, soupId, user.id);

		db.prepare(`DELETE FROM soup_tags WHERE soup_id=?`).run(soupId);
		const insertTag = db.prepare(`INSERT OR IGNORE INTO soup_tags (soup_id, tag_id) VALUES (?, ?)`);
		tagIds.forEach((tid) => insertTag.run(soupId, tid));

		if (action === "private") {
			createOrReplaceShareCode(db, soupId);
		} else {
			// 公开/草稿不保留旧分享码，避免旧私密链接继续访问
			db.prepare(`DELETE FROM share_codes WHERE soup_id=?`).run(soupId);
		}
	});

	tx();

	return res.redirect(`/my?msg=${encodeURIComponent(msg)}`);
}

function deleteMySoup(req, res) {
	const db = getDb();
	const user = req.session.user;
	const soupId = Number(req.params.id);

	if (!Number.isFinite(soupId)) {
		return res.redirect("/my?msg=参数错误");
	}

	const soup = loadSoupForOwner(db, soupId, user.id);
	if (!soup) {
		return res.redirect("/my?msg=没有找到这碗汤");
	}

	const tx = db.transaction(() => {
		// 兼容旧库：如果 notifications 表没有外键级联，也能清干净相关通知
		try {
			db.prepare(`
				DELETE FROM notifications
				WHERE soup_id=?
					OR comment_id IN (SELECT id FROM comments WHERE soup_id=?)
			`).run(soupId, soupId);
		} catch (e) {}

		// 这些表大多已有 ON DELETE CASCADE；这里手动删一次更稳，兼容旧库
		try { db.prepare(`DELETE FROM share_codes WHERE soup_id=?`).run(soupId); } catch (e) {}
		try { db.prepare(`DELETE FROM soup_tags WHERE soup_id=?`).run(soupId); } catch (e) {}
		try { db.prepare(`DELETE FROM likes WHERE soup_id=?`).run(soupId); } catch (e) {}
		try { db.prepare(`DELETE FROM comments WHERE soup_id=?`).run(soupId); } catch (e) {}
		try { db.prepare(`DELETE FROM audits WHERE soup_id=?`).run(soupId); } catch (e) {}

		db.prepare(`DELETE FROM soups WHERE id=? AND author_id=?`).run(soupId, user.id);
	});

	tx();

	return res.redirect("/my?msg=已删除海龟汤");
}

module.exports = {
	renderMySoups,
	regenerateShareCode,
	renderEditMySoup,
	postEditMySoup,
	deleteMySoup,
};
