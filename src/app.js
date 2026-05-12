const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");

const {
	PORT,
	SESSION_DB_FILE,
	SITE_TITLE,
	SESSION_SECRET,
	COOKIE_SECURE,
	TRUST_PROXY,
} = require("./config");
const { initDatabase, getDb } = require("./db/database");
const BetterSqliteSessionStore = require("./db/sessionStore");
const { formatDateTime } = require("./utils/time");
const { getUnreadCount } = require("./utils/notifications");

const indexRoutes = require("./routes/index");
const authRoutes = require("./routes/auth");
const soupRoutes = require("./routes/soups");
const myRoutes = require("./routes/my");
const messagesRoutes = require("./routes/messages");
const roomRoutes = require("./routes/rooms");
const tagRoutes = require("./routes/tags");
const adminRoutes = require("./routes/admin");
const feedbackRoutes = require("./routes/feedback");

initDatabase();

const app = express();
app.disable("x-powered-by");

if (TRUST_PROXY) app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

/**
 * 游客标识用于点赞去重和未登录反馈串联。
 * 这是随机 token，不包含用户名、手机号等可识别信息。
 */
app.use((req, res, next) => {
	if (!req.cookies.visitor_token) {
		const token = crypto.randomBytes(16).toString("hex");
		res.cookie("visitor_token", token, {
			httpOnly: true,
			sameSite: "lax",
			secure: COOKIE_SECURE && req.secure,
			maxAge: 365 * 24 * 60 * 60 * 1000,
		});
		req.cookies.visitor_token = token;
	}
	next();
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

const sessionStore = new BetterSqliteSessionStore({ file: SESSION_DB_FILE });
app.use(
	session({
		store: sessionStore,
		secret: SESSION_SECRET,
		name: "hgt.sid",
		resave: false,
		saveUninitialized: false,
		cookie: {
			maxAge: 7 * 24 * 60 * 60 * 1000,
			sameSite: "lax",
			secure: COOKIE_SECURE ? "auto" : false,
		},
	}),
);

// 定时清理过期 session，避免 sessions.sqlite3 长期膨胀。
setInterval(() => sessionStore.cleanupExpired(), 60 * 60 * 1000).unref();

/** 页面公共变量：模板可以直接读取站点名、当前用户、未读数和时间格式化函数。 */
app.use((req, res, next) => {
	res.locals.siteTitle = SITE_TITLE;
	res.locals.currentUser = req.session.user || null;
	res.locals.unreadCount = req.session.user ? getUnreadCount(req.session.user.id) : 0;
	res.locals.formatDateTime = formatDateTime;
	next();
});

/** 用户被后台禁用后，下一次请求会立即退出登录。 */
app.use((req, res, next) => {
	const user = req.session?.user;
	if (!user) return next();

	const row = getDb().prepare("SELECT is_disabled FROM users WHERE id=?").get(user.id);
	if (row && row.is_disabled === 1) {
		req.session.destroy(() => res.redirect("/auth/login"));
		return;
	}
	next();
});

app.use("/", indexRoutes);
app.use("/auth", authRoutes);
app.use("/soups", soupRoutes);
app.use("/my", myRoutes);
app.use("/messages", messagesRoutes);
app.use("/rooms", roomRoutes);
app.use("/tags", tagRoutes);
app.use("/admin", adminRoutes);
app.use("/feedback", feedbackRoutes);

app.use((req, res) => {
	res.status(404).render("404", { title: "页面不存在" });
});

app.listen(PORT, () => {
	console.log(`HGT site is running: http://localhost:${PORT}`);
	console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
	console.log(`SQLite data: ${path.relative(process.cwd(), require("./config").DB_FILE)}`);
});
