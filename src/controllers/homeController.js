const { getDb } = require("../db/database");

function renderHome(req, res) {
	const db = getDb();

	const q = (req.query.q || "").trim();
	const currentUser = req.session.user || null;
	const hideRead = !!(currentUser && req.query.hide_read === "1");

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

	const tagsParam = (req.query.tags || "").trim();
	const tagIds = tagsParam
		? tagsParam
				.split(",")
				.map((x) => Number(x))
				.filter((n) => Number.isFinite(n) && visibleTagIds.has(n))
		: [];

	let where = `WHERE s.visibility='public' AND s.status='approved'`;
	const params = [];

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
		const placeholders = tagIds.map(() => "?").join(",");
		where += ` AND EXISTS (
			SELECT 1 FROM soup_tags st
			WHERE st.soup_id = s.id AND st.tag_id IN (${placeholders})
		)`;
		params.push(...tagIds);
	}

	if (hideRead) {
		where += ` AND NOT EXISTS (
		SELECT 1 FROM soup_reveals sr
		WHERE sr.soup_id = s.id AND sr.user_id = ?
	)`;
		params.push(currentUser.id);
	}

	const sort = (req.query.sort || "").trim();

	let orderBy = "ORDER BY s.id DESC";
	if (sort === "hot_desc") orderBy = "ORDER BY like_count DESC, s.id DESC";
	if (sort === "hot_asc") orderBy = "ORDER BY like_count ASC, s.id DESC";
	if (sort === "rating_desc") orderBy = "ORDER BY COALESCE(rating_avg, 0) DESC, rating_count DESC, s.id DESC";
	if (sort === "rating_asc") orderBy = "ORDER BY COALESCE(rating_avg, 0) ASC, rating_count DESC, s.id DESC";

	const soups = db
		.prepare(
			`
		SELECT
			s.id, s.title, s.surface, s.created_at,
			(SELECT GROUP_CONCAT(t.name, '、') FROM soup_tags st JOIN tags t ON t.id=st.tag_id WHERE st.soup_id=s.id AND COALESCE(t.is_hidden,0)=0) AS tag_names,
			CASE
				WHEN s.is_anonymous = 1 THEN '匿名'
				ELSE COALESCE(u.username, 'Unknown')
			END AS author_name,
			(SELECT COUNT(1) FROM likes l WHERE l.soup_id = s.id) AS like_count,
			ROUND((SELECT AVG(r.score) FROM soup_ratings r WHERE r.soup_id = s.id), 1) AS rating_avg,
			(SELECT COUNT(1) FROM soup_ratings r WHERE r.soup_id = s.id) AS rating_count
		FROM soups s
		LEFT JOIN users u ON u.id = s.author_id
		${where}
		${orderBy}
	`,
		)
		.all(...params);

	const selectedTags = tags.filter((t) => tagIds.includes(t.id));

	// 首页当前展示公告：is_active=1 的最新一条
	const activeAnnouncement =
		db
			.prepare(
				`
		SELECT id, title, content, created_at, updated_at
		FROM announcements
		WHERE is_active=1
		ORDER BY datetime(updated_at) DESC, id DESC
		LIMIT 1
	`,
			)
			.get() || null;

	// 历史公告：包含当前公告，前端按 5 条/页分页
	const announcements = db
		.prepare(
			`
		SELECT id, title, content, is_active, created_at, updated_at
		FROM announcements
		ORDER BY datetime(updated_at) DESC, id DESC
		LIMIT 50
	`,
		)
		.all();

	res.render("home", {
		title: "海龟汤池",
		soups,
		tags,
		selectedTags,
		activeAnnouncement,
		announcements,
		query: { q, tagsParam: tagIds.join(","), sort, hideRead },
		currentUser,
	});
}

module.exports = { renderHome };
