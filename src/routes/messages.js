const express = require("express");
const router = express.Router();

const { requireLogin } = require("../middlewares/auth");
const { renderMessages } = require("../controllers/messagesController");

router.get("/", requireLogin, renderMessages);

module.exports = router;
