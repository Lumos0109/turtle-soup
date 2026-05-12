const crypto = require("crypto");
const { SHARE_CODE_EXPIRE_HOURS } = require("../config");

function makeCode() {
	return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function makeExpiresAt() {
	const hours = Number(SHARE_CODE_EXPIRE_HOURS) || 24;
	return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/**
 * 给某个私密汤创建或重新生成分享码。
 * share_codes.soup_id 是 UNIQUE，所以同一碗汤只保留一个有效 code。
 */
function createOrReplaceShareCode(db, soupId) {
	while (true) {
		const code = makeCode();
		const expiresAt = makeExpiresAt();

		try {
			const existing = db
				.prepare(`SELECT id FROM share_codes WHERE soup_id=?`)
				.get(soupId);

			if (existing) {
				db.prepare(
					`
          UPDATE share_codes
          SET code=?, expires_at=?, created_at=datetime('now','localtime')
          WHERE soup_id=?
        `,
				).run(code, expiresAt, soupId);
			} else {
				db.prepare(
					`
          INSERT INTO share_codes (soup_id, code, expires_at)
          VALUES (?, ?, ?)
        `,
				).run(soupId, code, expiresAt);
			}

			return { code, expiresAt };
		} catch (e) {
			// code 撞唯一索引时重试
		}
	}
}

function isShareExpired(expiresAt) {
	const t = new Date(expiresAt).getTime();
	return !Number.isFinite(t) || Date.now() > t;
}

module.exports = {
	createOrReplaceShareCode,
	isShareExpired,
};
