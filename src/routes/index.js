const express = require("express");
const { renderHome } = require("../controllers/homeController");
const { redeemShareCode } = require("../controllers/soupController");

const router = express.Router();

router.get("/", renderHome);

// ✅ 分享码入口
router.get("/share/:code", redeemShareCode);

module.exports = router;
