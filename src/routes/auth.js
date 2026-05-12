/**
 * 用户认证路由（注册/登录/退出）
 */
const express = require("express");
const router = express.Router();

const {
  renderLogin,
  renderRegister,
  postLogin,
  postRegister,
  postLogout,
} = require("../controllers/authController");

// 登录
router.get("/login", renderLogin);
router.post("/login", postLogin);

// 注册
router.get("/register", renderRegister);
router.post("/register", postRegister);

// 退出
router.post("/logout", postLogout);

module.exports = router;
