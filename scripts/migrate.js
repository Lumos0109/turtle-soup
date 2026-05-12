#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { initDatabase, getDb } = require("../src/db/database");
const { DB_FILE } = require("../src/config");

function backupDatabase() {
	if (!fs.existsSync(DB_FILE)) return null;
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
	const backupFile = `${DB_FILE}.bak.${stamp}`;
	fs.copyFileSync(DB_FILE, backupFile);
	return backupFile;
}

const backupFile = backupDatabase();
initDatabase();
const db = getDb();
const tables = db.prepare(`
	SELECT name FROM sqlite_master
	WHERE type='table' AND name NOT LIKE 'sqlite_%'
	ORDER BY name
`).all().map((row) => row.name);

console.log("数据库迁移完成");
console.log(`主库：${path.resolve(DB_FILE)}`);
if (backupFile) console.log(`备份：${path.resolve(backupFile)}`);
console.log(`数据表：${tables.join(", ")}`);
