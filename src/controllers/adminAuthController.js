/**
 * 管理员入口登录：只输入管理员密码
 * - 管理员账号固定用数据库里的 admin（role='admin'）
 * - 密码校验走 bcrypt 对比（使用 admin 账号的 password_hash）
 */

const bcrypt = require("bcryptjs");
const { getDb } = require("../db/database");
const { ADMIN_USERNAME } = require("../config");

function renderAdminLogin(req, res) {
	res.render("admin_login", {
		title: "管理员登录",
		error: null,
		next: req.query.next || "/admin",
	});
}

function postAdminLogin(req, res) {
	const db = getDb();
	const password = req.body.password || "";
	const nextUrl = req.body.next || "/admin";

	if (!password) {
		return res.status(400).render("admin_login", {
			title: "管理员登录",
			error: "请输入管理员密码。",
			next: nextUrl,
		});
	}

	// 固定找到管理员账号（你初始化数据里已有 admin）
	const admin = db
		.prepare(
			`SELECT id, username, password_hash, role, is_disabled
			FROM users
			WHERE username = ? AND role = 'admin'`,)
		.get(ADMIN_USERNAME);

	if (!admin) {
		return res.status(500).render("admin_login", {
			title: "管理员登录",
			error: "系统未初始化管理员账号，请检查数据库初始化。",
			next: nextUrl,
		});
	}

	if (admin.is_disabled === 1) {
		return res.status(403).render("admin_login", {
			title: "管理员登录",
			error: "管理员账号已被禁用。",
			next: nextUrl,
		});
	}

	const ok = bcrypt.compareSync(password, admin.password_hash);
	if (!ok) {
		return res.status(400).render("admin_login", {
			title: "管理员登录",
			error: "管理员密码错误。",
			next: nextUrl,
		});
	}

	// 登录成功：写 session。显式保存后再跳转，避免部分 session store 异步写入时丢登录态。
	req.session.user = {
		id: admin.id,
		username: admin.username,
		role: admin.role,
	};
	req.session.save((err) => {
		if (err) {
			console.error("保存管理员登录 session 失败:", err);
			return res.status(500).render("admin_login", {
				title: "管理员登录",
				error: "登录状态保存失败，请重试。",
				next: nextUrl,
			});
		}

		return res.redirect(nextUrl.startsWith("/") ? nextUrl : "/admin");
	});
}

module.exports = { renderAdminLogin, postAdminLogin };
