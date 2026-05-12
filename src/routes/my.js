const express = require("express");
const router = express.Router();

const { requireLogin } = require("../middlewares/auth");
const {
	renderMySoups,
	regenerateShareCode,
	renderEditMySoup,
	postEditMySoup,
	deleteMySoup,
} = require("../controllers/myController");

router.get("/", requireLogin, renderMySoups);

// 编辑/删除自己的海龟汤
router.get("/soups/:id/edit", requireLogin, renderEditMySoup);
router.post("/soups/:id/edit", requireLogin, postEditMySoup);
router.post("/soups/:id/delete", requireLogin, deleteMySoup);

// 私密分享码重新生成
router.post("/soups/:id/regenerate-share", requireLogin, regenerateShareCode);

module.exports = router;
