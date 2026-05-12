/**
 * 鉴权中间件：控制游客/用户/管理员权限
 * - requireLogin：必须登录，否则跳转登录页
 * - requireAdmin：必须管理员，否则 403
 */

function requireLogin(req, res, next) {
    if (req.session && req.session.user) return next();

    // 登录后回到原页面。
    const nextUrl = encodeURIComponent(req.originalUrl || "/");
    return res.redirect(`/auth/login?next=${nextUrl}`);
}

function requireAdmin(req, res, next) {
    const user = req.session && req.session.user;
    if (!user) {
        const nextUrl = encodeURIComponent(req.originalUrl || "/admin");
        return res.redirect(`/admin/login?next=${nextUrl}`);
    }
    if (user.role !== "admin") {
        return res.status(403).render("403", { title: "无权限" });
    }
    next();
}

module.exports = { requireLogin, requireAdmin };
