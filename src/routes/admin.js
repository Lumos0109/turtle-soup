/**
 * 管理员路由（功能5完整版）
 * - /admin/login：管理员密码登录入口（无需 requireAdmin）
 * - /admin：后台主页（需要 requireAdmin）
 * - /admin/soups/...：审核
 * - /admin/tags/...：标签CRUD
 * - /admin/users/...：用户禁用/解禁
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = express.Router();

const { requireAdmin } = require("../middlewares/auth");
const {
	renderAdminLogin,
	postAdminLogin,
} = require("../controllers/adminAuthController");

const {
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
} = require("../controllers/adminController");

const {
	renderFeedbackList,
	renderFeedbackThread,
	updateThread,
	markProcessed,
	closeThread,
	replyThread,
} = require("../controllers/adminFeedbackController");

const stickerUploadDir = path.join(__dirname, "..", "..", "public", "uploads", "stickers");
const stickerStorage = multer.diskStorage({
	destination: (req, file, cb) => {
		fs.mkdirSync(stickerUploadDir, { recursive: true });
		cb(null, stickerUploadDir);
	},
	filename: (req, file, cb) => {
		const ext = path.extname(file.originalname || "").toLowerCase();
		cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
	},
});

const stickerUpload = multer({
	storage: stickerStorage,
	fileFilter: (req, file, cb) => {
		if (!["image/png", "image/jpeg"].includes(file.mimetype)) {
			return cb(new Error("只支持 png 或 jpg 表情图片"));
		}
		cb(null, true);
	},
	limits: { fileSize: 1024 * 1024 },
});

// 管理员登录入口
router.get("/login", renderAdminLogin);
router.post("/login", postAdminLogin);

// 后台主页
router.get("/", requireAdmin, renderAdmin);

// 审核公开汤
router.post("/soups/:id/approve", requireAdmin, approveSoup);
router.post("/soups/:id/reject", requireAdmin, rejectSoup);

// 公开汤池内容编辑/删除
router.get("/soups/:id/edit", requireAdmin, renderEditSoup);
router.post("/soups/:id/edit", requireAdmin, updateSoup);
router.post("/soups/:id/delete", requireAdmin, deleteSoup);

// 标签管理
router.post("/tags", requireAdmin, createTag);
router.post("/tags/:id/update", requireAdmin, updateTag);
router.post("/tags/:id/delete", requireAdmin, deleteTag);

// 用户管理
router.post("/users/:id/toggle", requireAdmin, toggleUser);

// 公告管理
router.post("/announcements", requireAdmin, createAnnouncement);
router.post("/announcements/:id/update", requireAdmin, updateAnnouncement);
router.post("/announcements/:id/active", requireAdmin, setActiveAnnouncement);
router.post("/announcements/:id/delete", requireAdmin, deleteAnnouncement);

// 房间表情包管理
router.post("/stickers", requireAdmin, (req, res, next) => {
	stickerUpload.single("sticker")(req, res, (err) => {
		if (err) return res.redirect(`/admin?tab=stickers&msg=${encodeURIComponent(err.message || "表情上传失败")}`);
		next();
	});
}, uploadSticker);
router.post("/stickers/:id/delete", requireAdmin, deleteSticker);

// ====== 反馈系统（管理员侧） ======
router.get("/feedback", requireAdmin, renderFeedbackList);
router.get("/feedback/:id", requireAdmin, renderFeedbackThread);
router.post("/feedback/:id/update", requireAdmin, updateThread);
router.post("/feedback/:id/processed", requireAdmin, markProcessed);
router.post("/feedback/:id/close", requireAdmin, closeThread);
router.post("/feedback/:id/reply", requireAdmin, replyThread);

module.exports = router;
