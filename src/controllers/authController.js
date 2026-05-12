/**
 * 用户认证控制器：注册/登录/退出
 * 技术点：
 * - 密码用 bcryptjs 哈希存储（只保存哈希，不保存明文密码）
 * - 登录成功把 user 信息写入 session：req.session.user
 */

const bcrypt = require("bcryptjs");
const { getDb } = require("../db/database");

// 用户名规则：3~20 位，仅允许字母、数字、下划线。
function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function renderLogin(req, res) {
    res.render("login", {
        title: "登录",
        error: null,
        form: { username: "" },
        next: req.query.next || "/",
    });
}

function renderRegister(req, res) {
    res.render("register", {
        title: "注册",
        error: null,
        form: { username: "" },
    });
}

function postLogin(req, res) {
    const db = getDb();
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";
    const nextUrl = req.body.next || "/";

    // 基础校验
    if (!username || !password) {
        return res.status(400).render("login", {
            title: "登录",
            error: "请输入用户名和密码。",
            form: { username },
            next: nextUrl,
        });
    }

    const row = db.prepare(`SELECT id, username, password_hash, role, is_disabled FROM users WHERE username = ?`).get(username);
    if (!row) {
        return res.status(400).render("login", {
            title: "登录",
            error: "用户名或密码错误。",
            form: { username },
            next: nextUrl,
        });
    }

    // 不允许管理员从普通登录入口登录（保持“原版：ADMIN入口登录”）
    if (row.role === "admin") {
        return res.status(403).render("login", {
            title: "登录",
            error: "管理员请从右上角 ADMIN 入口登录。",
            form: { username },
            next: nextUrl,
        });
    }

    if (row.is_disabled === 1) {
        return res.status(403).render("login", {
            title: "登录",
            error: "该账号已被管理员禁用，请联系管理员。",
            form: { username },
            next: nextUrl,
        });
    }

    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) {
        return res.status(400).render("login", {
            title: "登录",
            error: "用户名或密码错误。",
            form: { username },
            next: nextUrl,
        });
    }

    // 写入 session（只放必要字段）
    req.session.user = { id: row.id, username: row.username, role: row.role };

    return res.redirect(nextUrl);
}

function postRegister(req, res) {
    const db = getDb();
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";
    const password2 = req.body.password2 || "";

    if (!username || !password || !password2) {
        return res.status(400).render("register", {
            title: "注册",
            error: "请把信息填写完整。",
            form: { username },
        });
    }

    if (!isValidUsername(username)) {
        return res.status(400).render("register", {
            title: "注册",
            error: "用户名格式不正确：需 3~20 位，只能包含字母/数字/下划线。",
            form: { username },
        });
    }

    if (password.length < 6) {
        return res.status(400).render("register", {
            title: "注册",
            error: "密码至少 6 位。",
            form: { username },
        });
    }

    if (password !== password2) {
        return res.status(400).render("register", {
            title: "注册",
            error: "两次输入的密码不一致。",
            form: { username },
        });
    }

    // 检查是否重复
    const exists = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
    if (exists) {
        return res.status(400).render("register", {
            title: "注册",
            error: "该用户名已被占用，请换一个。",
            form: { username },
        });
    }

    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')`).run(username, hash);

    // 注册后自动登录，减少一次登录跳转。
    req.session.user = { id: info.lastInsertRowid, username, role: "user" };
    return res.redirect("/");
}

function postLogout(req, res) {
    // 销毁 session
    req.session.destroy(() => {
        res.redirect("/");
    });
}

module.exports = { renderLogin, renderRegister, postLogin, postRegister, postLogout };
