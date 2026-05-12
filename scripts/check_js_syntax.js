#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const roots = ["src", "scripts", path.join("public", "js")];
const self = path.normalize(path.join("scripts", "check_js_syntax.js"));

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (entry.isFile() && full.endsWith(".js")) out.push(full);
	}
	return out;
}

const files = roots.flatMap((root) => walk(root)).filter((f) => path.normalize(f) !== self);

for (const file of files) {
	const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Checked ${files.length} JavaScript files.`);
