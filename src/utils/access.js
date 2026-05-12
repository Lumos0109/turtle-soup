/**
 * 访问控制：判断某条汤是否对当前请求“可访问”
 * 规则：
 * - public + approved：任何人可访问
 * - public + pending/rejected：作者本人或管理员可访问（方便预览）
 * - private：作者本人、管理员、或通过 /share/:code 兑换过（写入 session 允许列表）才可访问
 */

function canAccessSoup(req, soup) {
    const user = req.session && req.session.user;

    // 公共已通过
    if (soup.visibility === "public" && soup.status === "approved") return true;

    // 公共未通过：作者或管理员可看
    if (soup.visibility === "public" && soup.status !== "approved") {
        if (!user) return false;
        if (user.role === "admin") return true;
        return soup.author_id === user.id;
    }

    // 私密：作者/管理员/兑换过分享码
    if (soup.visibility === "private") {
        if (user && (user.role === "admin" || soup.author_id === user.id)) return true;

        const allow = req.session && req.session.allowedSoups;
        return !!(allow && allow[String(soup.id)] === 1);
    }

    return false;
}

function allowSoupInSession(req, soupId) {
    if (!req.session.allowedSoups) req.session.allowedSoups = {};
    req.session.allowedSoups[String(soupId)] = 1;
}

module.exports = { canAccessSoup, allowSoupInSession };
