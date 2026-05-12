const { createOrReplaceShareCode } = require("../utils/shareCode");
const { getDb } = require("../db/database");

function renderCreate(req, res) {
	const db = getDb();
	const tags = db
		.prepare(
			`
			SELECT id, name
			FROM tags
			WHERE COALESCE(is_hidden, 0)=0
			ORDER BY COALESCE(sort_order, id) ASC, id ASC
			`,
		)
		.all();

	res.render("create", {
		title: "NEW SOUP",
		tags,
		error: null,
		form: {
			title: "",
			surface: "",
			bottom: "",
			has_host_manual: 0,
			host_manual: "",
			is_anonymous: 0,
			visibility: "public",
			tagIds: [],
		},
	});
}

function postCreate(req, res) {
	const db = getDb();
	const user = req.session.user;

	const title = (req.body.title || "").trim();
	const surface = (req.body.surface || "").trim();
	const bottom = (req.body.bottom || "").trim();
	const hasHostManual = req.body.has_host_manual === "1" ? 1 : 0;
	const hostManual = hasHostManual ? (req.body.host_manual || "").trim() : "";

	const isAnonymous = req.body.is_anonymous === "1" ? 1 : 0;

	// action 来自点击的提交按钮：public / private / draft
	const action = (req.body.action || "public").trim();

	// 默认公开发布：进入待审核
	let visibility = "public";
	let status = "pending";

	if (action === "private") {
		visibility = "private";
		status = "approved";
	}

	if (action === "draft") {
		visibility = "private";
		status = "draft";
	}

	// tags 多选：tagIds=1&tagIds=2...
	let tagIds = req.body.tagIds || [];
	if (!Array.isArray(tagIds)) tagIds = [tagIds];
	tagIds = tagIds.map((x) => Number(x)).filter((n) => Number.isFinite(n));

	const tags = db
		.prepare(
			`
			SELECT id, name
			FROM tags
			WHERE COALESCE(is_hidden, 0)=0
			ORDER BY COALESCE(sort_order, id) ASC, id ASC
			`,
		)
		.all();

	const visibleTagIds = new Set(tags.map((t) => t.id));
	tagIds = tagIds.filter((id) => visibleTagIds.has(id));

	// ✅ 必填校验
	if (!title || !surface || !bottom) {
		return res.status(400).render("create", {
			title: "NEW SOUP",
			tags,
			error: "标题、汤面、汤底为必填项。",
			form: {
				title,
				surface,
				bottom,
				has_host_manual: hasHostManual,
				host_manual: hostManual,
				is_anonymous: isAnonymous,
				visibility,
				tagIds,
			},
		});
	}

	if (title.length > 60) {
		return res.status(400).render("create", {
			title: "NEW SOUP",
			tags,
			error: "标题最多 60 字。",
			form: {
				title,
				surface,
				bottom,
				has_host_manual: hasHostManual,
				host_manual: hostManual,
				is_anonymous: isAnonymous,
				visibility,
				tagIds,
			},
		});
	}

	if (surface.length > 1000 || bottom.length > 2000) {
		return res.status(400).render("create", {
			title: "NEW SOUP",
			tags,
			error: "汤面最多 1000 字，汤底最多 2000 字。",
			form: {
				title,
				surface,
				bottom,
				has_host_manual: hasHostManual,
				host_manual: hostManual,
				is_anonymous: isAnonymous,
				visibility,
				tagIds,
			},
		});
	}

	if (hasHostManual && !hostManual) {
		return res.status(400).render("create", {
			title: "NEW SOUP",
			tags,
			error: "勾选主持人手册后，请填写主持人手册内容。",
			form: {
				title,
				surface,
				bottom,
				has_host_manual: hasHostManual,
				host_manual: hostManual,
				is_anonymous: isAnonymous,
				visibility,
				tagIds,
			},
		});
	}

	if (hostManual.length > 2000) {
		return res.status(400).render("create", {
			title: "NEW SOUP",
			tags,
			error: "主持人手册最多 2000 字。",
			form: {
				title,
				surface,
				bottom,
				has_host_manual: hasHostManual,
				host_manual: hostManual,
				is_anonymous: isAnonymous,
				visibility,
				tagIds,
			},
		});
	}

	const info = db
		.prepare(
			`
				INSERT INTO soups (title, surface, bottom, has_host_manual, host_manual, author_id, is_anonymous, visibility, status)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
		)
		.run(title, surface, bottom, hasHostManual, hostManual || null, user.id, isAnonymous, visibility, status);

	const soupId = info.lastInsertRowid;

	// ✅ 绑定标签
	const insertSoupTag = db.prepare(
		`INSERT OR IGNORE INTO soup_tags (soup_id, tag_id) VALUES (?, ?)`,
	);
	tagIds.forEach((tid) => insertSoupTag.run(soupId, tid));

	// ✅ 私密：生成分享码（24小时有效）
	let share = null;
	if (action === "private") {
		share = createOrReplaceShareCode(db, soupId);
	}

	// 结果页
	return res.render("create_result", {
		title: "提交成功",
		action, // ✅ 新增
		visibility,
		status, // ✅ 新增（draft/pending/approved）
		soupId,
		share,
	});
}

module.exports = { renderCreate, postCreate };
