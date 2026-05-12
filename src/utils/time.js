const { TIME_ZONE } = require("../config");

function formatDateTime(value) {
	if (!value) return "";

	const raw = String(value).trim();

	const d = new Date(raw);
	if (!Number.isFinite(d.getTime())) {
		return raw;
	}

	return new Intl.DateTimeFormat("zh-CN", {
		timeZone: TIME_ZONE || "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	})
		.format(d)
		.replace(/\//g, "-");
}

module.exports = { formatDateTime };