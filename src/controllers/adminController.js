const { getDb } = require("../db/database");
const { createNotification } = require("../utils/notifications");

function renderAdmin(req, res) {
	const db = getDb();

	const qUser = (req.query.qUser || "").trim();
	const qSoup = (req.query.qSoup || "").trim();

	const pendingSoups = db.prepare(`
		SELECT s.id, s.title, s.created_at, COALESCE(u.username, 'Unknown') AS author_name
		FROM soups s
		LEFT JOIN users u ON u.id = s.author_id
		WHERE s.visibility='public' AND s.status='pending'
		ORDER BY s.id DESC
	`).all();

	const publicSoups = db.prepare(`
		SELECT
			s.id, s.title, s.created_at, s.updated_at,
			COALESCE(u.username, 'Unknown') AS author_name,
			(SELECT COUNT(1) FROM likes l WHERE l.soup_id=s.id) AS like_count
		FROM soups s
		LEFT JOIN users u ON u.id=s.author_id
		WHERE s.visibility='public'
			AND s.status='approved'
			AND (?='' OR s.title LIKE ? OR s.surface LIKE ?)
		ORDER BY s.id DESC
	`).all(qSoup, `%${qSoup}%`, `%${qSoup}%`);

	const tags = db.prepare(`
		SELECT id, name, COALESCE(sort_order, id) AS sort_order, COALESCE(is_hidden, 0) AS is_hidden
		FROM tags
		ORDER BY sort_order ASC, id ASC
	`).all();

	const users = db.prepare(`
		SELECT id, username, role, is_disabled, created_at
		FROM users
		WHERE role='user'
			AND (?='' OR username LIKE ?)
		ORDER BY id DESC
	`).all(qUser, `%${qUser}%`);

	const announcements = db.prepare(`
		SELECT id, title, content, is_active, created_at, updated_at
		FROM announcements
		ORDER BY datetime(updated_at) DESC, id DESC
	`).all();

	const stickers = db.prepare(`
		SELECT id, url, filename, original_name, created_at
		FROM room_stickers
		WHERE COALESCE(is_deleted, 0)=0
		ORDER BY id DESC
	`).all();

	res.render("admin", {
		title: "管理后台",
		pendingSoups,
		publicSoups,
		tags,
		users,
		announcements,
		stickers,
		qUser,
		qSoup,
		message: req.query.msg || null,
		tab: req.query.tab || "review",
	});
}

function approveSoup(req, res) {
	const db = getDb();
	const soupId = Number(req.params.id);
	const admin = req.session.user;

	if (!Number.isFinite(soupId)) return res.redirect("/admin?tab=review&msg=参数错误");

	const soup = db.prepare(`SELECT id, title, author_id, visibility, status FROM soups WHERE id=?`).get(soupId);
	if (!soup || soup.visibility !== "public") return res.redirect("/admin?tab=review&msg=未找到该公开汤");
	if (soup.status !== "pending") return res.redirect("/admin?tab=review&msg=该海龟汤不在待审核状态");

	db.prepare(`UPDATE soups SET status='approved', review_note=NULL, updated_at=datetime('now','localtime') WHERE id=?`).run(soupId);
	db.prepare(`INSERT INTO audits (soup_id, admin_id, action, note) VALUES (?, ?, 'approve', NULL)`).run(soupId, admin.id);

	if (soup.author_id) {
		createNotification({
			userId: soup.author_id,
			type: "soup_approved",
			title: "公开汤审核通过",
			content: `你的海龟汤《${soup.title}》已审核通过，现已展示在公开汤池。`,
			linkUrl: `/soups/${soupId}`,
			actorUserId: admin.id,
			soupId,
		});
	}

	return res.redirect("/admin?tab=review&msg=审核通过");
}

function rejectSoup(req, res) {
	const db = getDb();
	const soupId = Number(req.params.id);
	const admin = req.session.user;
	const note = (req.body.note || "").trim().slice(0, 120);

	if (!Number.isFinite(soupId)) return res.redirect("/admin?tab=review&msg=参数错误");

	const soup = db.prepare(`SELECT id, title, author_id, visibility, status FROM soups WHERE id=?`).get(soupId);
	if (!soup || soup.visibility !== "public") return res.redirect("/admin?tab=review&msg=未找到该公开汤");
	if (soup.status !== "pending") return res.redirect("/admin?tab=review&msg=该海龟汤不在待审核状态");

	db.prepare(`UPDATE soups SET status='rejected', review_note=?, updated_at=datetime('now','localtime') WHERE id=?`).run(note || null, soupId);
	db.prepare(`INSERT INTO audits (soup_id, admin_id, action, note) VALUES (?, ?, 'reject', ?)`).run(soupId, admin.id, note || null);

	if (soup.author_id) {
		createNotification({
			userId: soup.author_id,
			type: "soup_rejected",
			title: "公开汤审核被驳回",
			content: `你的海龟汤《${soup.title}》被驳回。原因：${note || "管理员未填写驳回原因"}`,
			linkUrl: "/my",
			actorUserId: admin.id,
			soupId,
		});
	}

	return res.redirect("/admin?tab=review&msg=已驳回");
}

function createTag(req, res) {
	const db = getDb();
	const name = (req.body.name || "").trim();

	if (!name) return res.redirect("/admin?tab=tags&msg=标签名不能为空");
	if (name.length > 20) return res.redirect("/admin?tab=tags&msg=标签名最多20字");

	const nextOrder = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM tags`).get().n;

	try {
		db.prepare(`INSERT INTO tags (name, sort_order, is_hidden) VALUES (?, ?, 0)`).run(name, nextOrder);
	} catch (e) {
		return res.redirect("/admin?tab=tags&msg=标签名已存在");
	}

	return res.redirect("/admin?tab=tags&msg=已新增标签");
}

function updateTag(req, res) {
	const db = getDb();
	const tagId = Number(req.params.id);
	const name = (req.body.name || "").trim();
	const sortOrder = Number(req.body.sort_order);
	const isHidden = req.body.is_hidden === "1" ? 1 : 0;

	if (!Number.isFinite(tagId)) return res.redirect("/admin?tab=tags&msg=参数错误");
	if (!name) return res.redirect("/admin?tab=tags&msg=标签名不能为空");
	if (name.length > 20) return res.redirect("/admin?tab=tags&msg=标签名最多20字");

	try {
		db.prepare(`
			UPDATE tags
			SET name=?, sort_order=?, is_hidden=?
			WHERE id=?
		`).run(name, Number.isFinite(sortOrder) ? sortOrder : tagId, isHidden, tagId);
	} catch (e) {
		return res.redirect("/admin?tab=tags&msg=标签名已存在");
	}

	return res.redirect("/admin?tab=tags&msg=标签已更新");
}

function deleteTag(req, res) {
	const db = getDb();
	const tagId = Number(req.params.id);

	if (!Number.isFinite(tagId)) return res.redirect("/admin?tab=tags&msg=参数错误");

	db.prepare(`DELETE FROM soup_tags WHERE tag_id=?`).run(tagId);
	db.prepare(`DELETE FROM tags WHERE id=?`).run(tagId);

	return res.redirect("/admin?tab=tags&msg=已删除标签");
}

function toggleUser(req, res) {
	const db = getDb();
	const userId = Number(req.params.id);

	if (!Number.isFinite(userId)) return res.redirect("/admin?tab=users&msg=参数错误");

	const user = db.prepare(`SELECT id, is_disabled FROM users WHERE id=? AND role='user'`).get(userId);
	if (!user) return res.redirect("/admin?tab=users&msg=用户不存在");

	const next = user.is_disabled === 1 ? 0 : 1;
	db.prepare(`UPDATE users SET is_disabled=? WHERE id=?`).run(next, userId);

	return res.redirect(`/admin?tab=users&msg=${next ? "已禁用用户" : "已解禁用户"}`);
}

function renderEditSoup(req, res) {
	const db = getDb();
	const soupId = Number(req.params.id);

	if (!Number.isFinite(soupId)) return res.redirect("/admin?tab=publicSoups&msg=参数错误");

	const soup = db.prepare(`SELECT * FROM soups WHERE id=?`).get(soupId);
	if (!soup) return res.redirect("/admin?tab=publicSoups&msg=海龟汤不存在");

	const tags = db.prepare(`
		SELECT id, name, COALESCE(is_hidden,0) AS is_hidden
		FROM tags
		ORDER BY COALESCE(sort_order, id) ASC, id ASC
	`).all();

	const selectedTagIds = db.prepare(`SELECT tag_id FROM soup_tags WHERE soup_id=?`).all(soupId).map((x) => x.tag_id);

	res.render("admin_soup_edit", {
		title: "编辑海龟汤",
		soup,
		tags,
		selectedTagIds,
		error: null,
	});
}

function updateSoup(req, res) {
	const db = getDb();
	const soupId = Number(req.params.id);

	const title = (req.body.title || "").trim();
	const surface = (req.body.surface || "").trim();
	const bottom = (req.body.bottom || "").trim();
	const hasHostManual = req.body.has_host_manual === "1" ? 1 : 0;
	const hostManual = hasHostManual ? (req.body.host_manual || "").trim() : "";
	const isAnonymous = req.body.is_anonymous === "1" ? 1 : 0;

	let tagIds = req.body.tagIds || [];
	if (!Array.isArray(tagIds)) tagIds = [tagIds];
	tagIds = tagIds.map((x) => Number(x)).filter((n) => Number.isFinite(n));

	if (!Number.isFinite(soupId)) return res.redirect("/admin?tab=publicSoups&msg=参数错误");

	if (!title || !surface || !bottom) {
		return res.redirect(`/admin/soups/${soupId}/edit?msg=标题、汤面、汤底不能为空`);
	}

	if (title.length > 60) {
		return res.redirect(`/admin/soups/${soupId}/edit?msg=标题最多60字`);
	}

	if (surface.length > 1000 || bottom.length > 2000) {
		return res.redirect(`/admin/soups/${soupId}/edit?msg=汤面最多1000字，汤底最多2000字`);
	}

	if (hasHostManual && !hostManual) {
		return res.redirect(`/admin/soups/${soupId}/edit?msg=勾选主持人手册后，请填写主持人手册内容`);
	}

	if (hostManual.length > 2000) {
		return res.redirect(`/admin/soups/${soupId}/edit?msg=主持人手册最多2000字`);
	}

	db.prepare(`
		UPDATE soups
		SET title=?, surface=?, bottom=?, has_host_manual=?, host_manual=?, is_anonymous=?, updated_at=datetime('now','localtime')
		WHERE id=?
	`).run(title, surface, bottom, hasHostManual, hostManual || null, isAnonymous, soupId);

	db.prepare(`DELETE FROM soup_tags WHERE soup_id=?`).run(soupId);
	const insert = db.prepare(`INSERT OR IGNORE INTO soup_tags (soup_id, tag_id) VALUES (?, ?)`);
	tagIds.forEach((tid) => insert.run(soupId, tid));

	return res.redirect("/admin?tab=publicSoups&msg=海龟汤已更新");
}

function deleteSoup(req, res) {
	const db = getDb();
	const soupId = Number(req.params.id);

	if (!Number.isFinite(soupId)) return res.redirect("/admin?tab=publicSoups&msg=参数错误");

	db.prepare(`DELETE FROM soups WHERE id=?`).run(soupId);

	return res.redirect("/admin?tab=publicSoups&msg=已删除海龟汤");
}


function createAnnouncement(req, res) {
	const db = getDb();
	const title = (req.body.title || "").trim();
	const content = (req.body.content || "").trim();
	const setActive = req.body.set_active === "1";

	if (!title || !content) return res.redirect("/admin?tab=announcements&msg=公告标题和内容不能为空");
	if (title.length > 60) return res.redirect("/admin?tab=announcements&msg=公告标题最多60字");
	if (content.length > 1000) return res.redirect("/admin?tab=announcements&msg=公告内容最多1000字");

	if (setActive) db.prepare(`UPDATE announcements SET is_active=0`).run();

	db.prepare(`
		INSERT INTO announcements (title, content, is_active)
		VALUES (?, ?, ?)
	`).run(title, content, setActive ? 1 : 0);

	return res.redirect("/admin?tab=announcements&msg=公告已新增");
}

function updateAnnouncement(req, res) {
	const db = getDb();
	const id = Number(req.params.id);
	const title = (req.body.title || "").trim();
	const content = (req.body.content || "").trim();

	if (!Number.isFinite(id)) return res.redirect("/admin?tab=announcements&msg=参数错误");
	if (!title || !content) return res.redirect("/admin?tab=announcements&msg=公告标题和内容不能为空");
	if (title.length > 60) return res.redirect("/admin?tab=announcements&msg=公告标题最多60字");
	if (content.length > 1000) return res.redirect("/admin?tab=announcements&msg=公告内容最多1000字");

	db.prepare(`
		UPDATE announcements
		SET title=?, content=?, updated_at=datetime('now','localtime')
		WHERE id=?
	`).run(title, content, id);

	return res.redirect("/admin?tab=announcements&msg=公告已更新");
}

function setActiveAnnouncement(req, res) {
	const db = getDb();
	const id = Number(req.params.id);
	if (!Number.isFinite(id)) return res.redirect("/admin?tab=announcements&msg=参数错误");

	const row = db.prepare(`SELECT id FROM announcements WHERE id=?`).get(id);
	if (!row) return res.redirect("/admin?tab=announcements&msg=公告不存在");

	db.prepare(`UPDATE announcements SET is_active=0`).run();
	db.prepare(`UPDATE announcements SET is_active=1, updated_at=datetime('now','localtime') WHERE id=?`).run(id);

	return res.redirect("/admin?tab=announcements&msg=已设为首页展示公告");
}

function deleteAnnouncement(req, res) {
	const db = getDb();
	const id = Number(req.params.id);
	if (!Number.isFinite(id)) return res.redirect("/admin?tab=announcements&msg=参数错误");

	db.prepare(`DELETE FROM announcements WHERE id=?`).run(id);
	return res.redirect("/admin?tab=announcements&msg=公告已删除");
}

function uploadSticker(req, res) {
	const db = getDb();
	if (!req.file) return res.redirect("/admin?tab=stickers&msg=请选择 png 或 jpg 表情图片");

	const url = `/uploads/stickers/${req.file.filename}`;
	db.prepare(`
		INSERT INTO room_stickers (url, filename, original_name)
		VALUES (?, ?, ?)
	`).run(url, req.file.filename, req.file.originalname || null);

	return res.redirect("/admin?tab=stickers&msg=表情已上传");
}

function deleteSticker(req, res) {
	const db = getDb();
	const id = Number(req.params.id);
	if (!Number.isFinite(id)) return res.redirect("/admin?tab=stickers&msg=参数错误");

	db.prepare(`UPDATE room_stickers SET is_deleted=1 WHERE id=?`).run(id);
	return res.redirect("/admin?tab=stickers&msg=表情已删除");
}

module.exports = {
	renderAdmin,
	approveSoup,
	rejectSoup,
	createTag,
	updateTag,
	deleteTag,
	toggleUser,
	renderEditSoup,
	updateSoup,
	deleteSoup,
	createAnnouncement,
	updateAnnouncement,
	setActiveAnnouncement,
	deleteAnnouncement,
	uploadSticker,
	deleteSticker,
};
