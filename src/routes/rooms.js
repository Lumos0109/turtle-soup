const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { requireLogin } = require("../middlewares/auth");
const config = require("../config");
const roomController = require("../controllers/roomController");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "..", "public", "uploads", "room-hints");
const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		fs.mkdirSync(uploadDir, { recursive: true });
		cb(null, uploadDir);
	},
	filename: (req, file, cb) => {
		const ext = path.extname(file.originalname || "").toLowerCase();
		cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
	},
});

const allowedMime = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const upload = multer({
	storage,
	fileFilter: (req, file, cb) => {
		if (!allowedMime.has(file.mimetype)) return cb(new Error("只支持 jpg/png/webp/gif 图片"));
		cb(null, true);
	},
	limits: {
		fileSize: Number(config.ROOM_HINT_MAX_IMAGE_BYTES) || 2 * 1024 * 1024,
		files: Number(config.ROOM_HINT_MAX_IMAGES) || 5,
	},
});

router.get("/", requireLogin, roomController.renderRoomIndex);
router.post("/", requireLogin, roomController.createRoom);
router.post("/create", requireLogin, roomController.createRoom);
router.get("/new", requireLogin, roomController.renderNewRoom);
router.get("/:code", requireLogin, roomController.renderRoom);
router.get("/:code/state", requireLogin, roomController.getState);
router.get("/:code/search-soups", requireLogin, roomController.searchSoups);
router.post("/:code/sit-host", requireLogin, roomController.sitHost);
router.post("/:code/leave-host", requireLogin, roomController.leaveHost);
router.post("/:code/presence", requireLogin, roomController.presence);
router.post("/:code/start", requireLogin, roomController.startSoup);
router.post("/:code/question", requireLogin, roomController.postQuestion);
router.post("/:code/answer", requireLogin, roomController.answerQuestion);
router.post("/:code/history/:eventId/delete", requireLogin, roomController.deleteHistoryEvent);
router.post("/:code/chat", requireLogin, roomController.postChat);
router.post("/:code/sticker", requireLogin, roomController.postSticker);
router.post("/:code/finish", requireLogin, roomController.finishSoup);
router.post("/:code/reset", requireLogin, roomController.resetRoom);
router.post(
	"/:code/hint",
	requireLogin,
	(req, res, next) => {
		upload.array("images", Number(config.ROOM_HINT_MAX_IMAGES) || 5)(req, res, (err) => {
			if (err) return res.status(400).json({ message: err.message || "图片上传失败" });
			next();
		});
	},
	roomController.postHint,
);

module.exports = router;
