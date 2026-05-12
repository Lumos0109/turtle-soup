/**
 * 全局配置文件
 * 本地开发：使用默认值
 * 生产部署：通过 Docker Compose 的 .env.production 注入环境变量
 */
require("dotenv").config({ quiet: true });

const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

const TIME_ZONE = process.env.TIME_ZONE || process.env.TZ || "Asia/Shanghai";

// 让 Node 进程也使用这个时区
if (!process.env.TZ) {
	process.env.TZ = TIME_ZONE;
}

module.exports = {
	PORT,
	TIME_ZONE,

	DB_FILE: process.env.DB_FILE
		? path.resolve(process.env.DB_FILE)
		: path.join(__dirname, "..", "data", "hgt.sqlite3"),

	SESSION_DB_FILE: process.env.SESSION_DB_FILE
		? path.resolve(process.env.SESSION_DB_FILE)
		: path.join(__dirname, "..", "data", "sessions.sqlite3"),

	SITE_TITLE: process.env.SITE_TITLE || "TURTLE-SOUP",

	BASE_URL: process.env.BASE_URL || `http://localhost:${PORT}`,

	SHARE_CODE_EXPIRE_HOURS: Number(process.env.SHARE_CODE_EXPIRE_HOURS) || 24,

	// 生产环境必须在 .env.production 里设置一个很长的随机字符串
	SESSION_SECRET:
		process.env.SESSION_SECRET ||
		"dev_only_change_this_session_secret_before_production",

	// Caddy 反代 HTTPS 时开启
	TRUST_PROXY: process.env.TRUST_PROXY === "1",
	COOKIE_SECURE: process.env.COOKIE_SECURE === "1",

	// 默认生产环境不插入测试汤/测试普通用户
	CREATE_DEMO_DATA:
		process.env.CREATE_DEMO_DATA === "1" ||
		(!isProd && process.env.CREATE_DEMO_DATA !== "0"),

	// 管理员账号
	ADMIN_USERNAME: process.env.ADMIN_USERNAME || "admin",
	ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "Admin123!",

	// LLM 主持人配置。默认使用豆包 Ark Responses API。
	// 本地 .env / 生产 .env.production 填写 LLM_API_KEY 即可。
	LLM_PROVIDER: process.env.LLM_PROVIDER || "doubao_responses",
	LLM_BASE_URL: process.env.LLM_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
	LLM_API_KEY:
		process.env.LLM_API_KEY ||
		process.env.ARK_API_KEY ||
		process.env.DOUBAO_API_KEY ||
		"",
	LLM_MODEL: process.env.LLM_MODEL || "doubao-seed-2-0-lite-260428",
	LLM_TIMEOUT_MS: Number(process.env.LLM_TIMEOUT_MS) || 30000,
	LLM_DEBUG: process.env.LLM_DEBUG === "1",

	// 房间系统配置（小服务器友好：控制并发和闲置资源）
	ROOM_MAX_ACTIVE: Number(process.env.ROOM_MAX_ACTIVE) || 5,
	ROOM_MAX_MEMBERS: Number(process.env.ROOM_MAX_MEMBERS) || 12,
	ROOM_MAX_HISTORY: Number(process.env.ROOM_MAX_HISTORY) || 200,
	ROOM_WAITING_IDLE_MINUTES: Number(process.env.ROOM_WAITING_IDLE_MINUTES) || 30,
	ROOM_PLAYING_IDLE_MINUTES: Number(process.env.ROOM_PLAYING_IDLE_MINUTES) || 180,
	ROOM_MEMBER_OFFLINE_SECONDS: Number(process.env.ROOM_MEMBER_OFFLINE_SECONDS) || 35,
	ROOM_HINT_MAX_IMAGES: Number(process.env.ROOM_HINT_MAX_IMAGES) || 5,
	ROOM_HINT_MAX_IMAGE_BYTES: Number(process.env.ROOM_HINT_MAX_IMAGE_BYTES) || 2 * 1024 * 1024,

	// 反馈系统配置
	FEEDBACK_MAX_TEXT_LEN: Number(process.env.FEEDBACK_MAX_TEXT_LEN) || 100,
	FEEDBACK_MAX_USER_TEXT_MESSAGES:
		Number(process.env.FEEDBACK_MAX_USER_TEXT_MESSAGES) || 5,
	FEEDBACK_MAX_IMAGES_PER_THREAD:
		Number(process.env.FEEDBACK_MAX_IMAGES_PER_THREAD) || 3,
	FEEDBACK_MAX_IMAGE_BYTES:
		Number(process.env.FEEDBACK_MAX_IMAGE_BYTES) || 2 * 1024 * 1024,
};
