/**
 * HTTP/URL 小工具。
 * 目标：避免把用户提交的 next/link_url 直接用于跳转，防止开放重定向或 javascript: 链接。
 */

function safeRedirectPath(value, fallback = "/") {
	const raw = String(value || "").trim();
	if (!raw) return fallback;

	// 只允许站内绝对路径：/path?query#hash
	// 禁止 //evil.com、http://、https://、javascript: 等外部/伪协议地址。
	if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;

	try {
		const url = new URL(raw, "http://local.invalid");
		return `${url.pathname}${url.search}${url.hash}` || fallback;
	} catch (e) {
		return fallback;
	}
}

module.exports = { safeRedirectPath };
