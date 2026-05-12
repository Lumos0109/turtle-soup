const express = require("express");
const { getDb } = require("../db/database");

const router = express.Router();

/** 标签列表接口：给前端按需获取当前可见标签。 */
router.get("/", (req, res) => {
	const tags = getDb()
		.prepare(`
			SELECT id, name
			FROM tags
			WHERE COALESCE(is_hidden, 0)=0
			ORDER BY COALESCE(sort_order, id) ASC, id ASC
		`)
		.all();
	res.json({ tags });
});

module.exports = router;
