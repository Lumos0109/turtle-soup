/**
 * 反馈系统路由（用户侧）
 */
const express = require("express");
const router = express.Router();

const path = require("path");
const fs = require("fs");
const multer = require("multer");

const {
	FEEDBACK_MAX_IMAGE_BYTES,
	FEEDBACK_MAX_IMAGES_PER_THREAD,
} = require("../config");

const { getThread, postMessage } = require("../controllers/feedbackController");

// 上传目录：public/uploads/feedback（静态可访问）
const uploadDir = path.join(
	__dirname,
	"..",
	"..",
	"public",
	"uploads",
	"feedback",
);

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		fs.mkdirSync(uploadDir, { recursive: true });
		cb(null, uploadDir);
	},
	filename: (req, file, cb) => {
		const ext = path.extname(file.originalname || "").toLowerCase();
		const name = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
		cb(null, name);
	},
});

const allowedMime = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
]);
function fileFilter(req, file, cb) {
	if (!allowedMime.has(file.mimetype)) {
		return cb(new Error("只支持 jpg/png/webp/gif 图片"));
	}
	cb(null, true);
}

const upload = multer({
	storage,
	fileFilter,
	limits: {
		fileSize: FEEDBACK_MAX_IMAGE_BYTES, // 单张大小限制
		files: FEEDBACK_MAX_IMAGES_PER_THREAD, // 单次最多选择3张（会话总数另有校验）
	},
});

// 获取会话
router.get("/thread", getThread);

// 发送消息（带图片）
router.post(
	"/message",
	(req, res, next) => {
		upload.array("images", FEEDBACK_MAX_IMAGES_PER_THREAD)(req, res, (err) => {
			if (err) {
				return res.status(400).json({ message: err.message || "图片上传失败" });
			}
			next();
		});
	},
	postMessage,
);

module.exports = router;
