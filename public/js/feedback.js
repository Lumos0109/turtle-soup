/**
 * 首页反馈聊天弹窗
 *
 * 行为：
 * 1. 打开弹窗时加载最近会话
 * 2. 如果最近会话已关闭，提示用户“再次联系管理员会新开会话”
 * 3. 用户关闭弹窗后再次点击“联系管理员”，才会新建会话
 * 4. 管理员回复后，用户当前轮次额度刷新为 5 条文字 + 3 张图片
 */

(function () {
	const openBtn = document.getElementById("fbOpen");
	const modal = document.getElementById("fbModal");
	const mask = document.getElementById("fbMask");
	const closeBtn = document.getElementById("fbClose");

	const statusEl = document.getElementById("fbStatus");
	const messagesEl = document.getElementById("fbMessages");
	const errorEl = document.getElementById("fbError");

	const form = document.getElementById("fbForm");
	const textEl = document.getElementById("fbText");
	const countEl = document.getElementById("fbCount");
	const remainEl = document.getElementById("fbRemain");
	const imagesEl = document.getElementById("fbImages");
	const previewEl = document.getElementById("fbPreview");
	const sendBtn = document.getElementById("fbSend");

	if (!openBtn || !modal) return;

	let state = {
		thread: null,
		limits: {
			maxTextLen: 100,
			maxUserTextMessages: 5,
			maxImages: 3,
			maxImageBytes: 2 * 1024 * 1024,
		},
		usage: { remainingText: 5, remainingImages: 3 },
		selectedFiles: [],
		closedSeen: false,
	};

	function showError(msg) {
		if (!errorEl) return;
		errorEl.textContent = msg;
		errorEl.classList.remove("hidden");
		setTimeout(() => errorEl.classList.add("hidden"), 2600);
	}

	function escapeHtml(str) {
		return String(str)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}

	function setModal(open) {
		modal.classList.toggle("hidden", !open);
	}

	function renderRemain() {
		const maxText =
			Number(state.limits && state.limits.maxUserTextMessages) || 5;
		const maxImages = Number(state.limits && state.limits.maxImages) || 3;

		const remainTextRaw = Number(state.usage && state.usage.remainingText);
		const remainImagesRaw = Number(state.usage && state.usage.remainingImages);

		const remainText = Number.isFinite(remainTextRaw) ? remainTextRaw : maxText;
		const remainImages = Number.isFinite(remainImagesRaw)
			? remainImagesRaw
			: maxImages;

		remainEl.textContent = `剩余文字消息：${remainText}/${maxText} · 剩余图片：${remainImages}/${maxImages}`;
	}

	function renderStatus() {
		statusEl.textContent = state.thread ? state.thread.statusText : "待处理";
	}

	function setInputDisabled(disabled, closedMessage) {
		textEl.disabled = disabled;
		imagesEl.disabled = disabled;
		sendBtn.disabled = disabled;

		if (disabled) {
			textEl.placeholder = closedMessage || "会话已关闭";
		} else {
			textEl.placeholder =
				"你有什么意见或者问题需要反馈吗？阿禾看到后会尽快回复的喔~";
		}
	}

	function renderMessages(messages) {
		messagesEl.innerHTML = "";

		if (!messages || messages.length === 0) {
			messagesEl.innerHTML = `<div class="font-mono text-xs text-neutral-400 italic">还没有消息，先发一条吧～</div>`;
			return;
		}

		messages.forEach((m) => {
			const isUser = m.sender === "user";
			const wrap = document.createElement("div");
			wrap.className = `flex ${isUser ? "justify-end" : "justify-start"}`;

			const bubble = document.createElement("div");
			bubble.className =
				`max-w-[80%] border-2 border-black p-3 text-sm ` +
				(isUser ? "bg-black text-white" : "bg-white text-black");

			const meta = document.createElement("div");
			meta.className = `font-mono text-[10px] ${isUser ? "text-neutral-300" : "text-neutral-500"} mb-1`;
			meta.textContent = isUser ? "我" : "管理员";

			bubble.appendChild(meta);

			if (m.content) {
				const content = document.createElement("div");
				content.className = "whitespace-pre-wrap";
				content.innerHTML = escapeHtml(m.content);
				bubble.appendChild(content);
			}

			if (m.attachments && m.attachments.length > 0) {
				const imgs = document.createElement("div");
				imgs.className = "mt-2 flex gap-2 flex-wrap";
				m.attachments.forEach((a) => {
					const img = document.createElement("img");
					img.src = a.file_path;
					img.alt = "image";
					img.className = "w-20 h-20 object-cover border border-neutral-200";
					imgs.appendChild(img);
				});
				bubble.appendChild(imgs);
			}

			wrap.appendChild(bubble);
			messagesEl.appendChild(wrap);
		});

		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	function renderPreview() {
		previewEl.innerHTML = "";

		state.selectedFiles.forEach((f, idx) => {
			const url = URL.createObjectURL(f);

			const box = document.createElement("div");
			box.className = "relative";

			const img = document.createElement("img");
			img.src = url;
			img.className = "w-16 h-16 object-cover border-2 border-black bg-white";

			const del = document.createElement("button");
			del.type = "button";
			del.className =
				"absolute -top-2 -right-2 w-6 h-6 rounded-full border-2 border-black bg-white font-mono text-xs";
			del.textContent = "×";
			del.addEventListener("click", () => {
				state.selectedFiles.splice(idx, 1);
				renderPreview();
			});

			box.appendChild(img);
			box.appendChild(del);
			previewEl.appendChild(box);
		});
	}

	async function loadThread(startNewIfClosed) {
		const url = startNewIfClosed
			? "/feedback/thread?startNewIfClosed=1"
			: "/feedback/thread";

		const res = await fetch(url);
		const data = await res.json();

		state.thread = data.thread;
		state.limits = data.limits || state.limits;
		state.usage = data.usage || state.usage;

		renderStatus();
		renderRemain();
		renderMessages(data.messages);

		const closed = state.thread && state.thread.status === "closed";

		if (closed) {
			state.closedSeen = true;
			setInputDisabled(true, "会话已关闭，若还有其他疑问请再次联系管理员");
			showError("会话已关闭，若还有其他疑问请再次联系管理员。");
		} else {
			state.closedSeen = false;
			setInputDisabled(false);
		}
	}

	textEl.addEventListener("input", () => {
		countEl.textContent = String(textEl.value.length);
	});

	imagesEl.addEventListener("change", () => {
		const files = Array.from(imagesEl.files || []);
		imagesEl.value = "";

		const remain = Number(state.usage && state.usage.remainingImages) || 0;
		if (remain <= 0)
			return showError(
				"当前轮次已达到图片数量上限（3张），请等待管理员回复后继续。",
			);

		const maxBytes =
			Number(state.limits && state.limits.maxImageBytes) || 2 * 1024 * 1024;

		const validFiles = [];
		for (const f of files) {
			if (f.size > maxBytes) {
				showError("单张图片不能超过 2MB。");
				continue;
			}
			validFiles.push(f);
		}

		const pick = validFiles.slice(0, remain);
		state.selectedFiles = state.selectedFiles.concat(pick).slice(0, remain);
		renderPreview();
	});

	form.addEventListener("submit", async (e) => {
		e.preventDefault();

		const text = (textEl.value || "").trim();

		if (text.length > state.limits.maxTextLen) {
			return showError(`单条文字最多 ${state.limits.maxTextLen} 字`);
		}

		if (text && state.usage.remainingText <= 0) {
			return showError(
				"当前轮次已达到 5 条文字消息上限，请等待管理员回复后继续。",
			);
		}

		if (!text && state.selectedFiles.length === 0) {
			return showError("请填写文字或选择图片再发送。");
		}

		const fd = new FormData();
		fd.append("content", text);
		state.selectedFiles.forEach((f) => fd.append("images", f));

		try {
			const res = await fetch("/feedback/message", {
				method: "POST",
				body: fd,
			});
			const data = await res.json().catch(() => ({}));

			if (!res.ok) {
				if (data.code === "THREAD_CLOSED") {
					state.closedSeen = true;
					setInputDisabled(true, "会话已关闭，若还有其他疑问请再次联系管理员");
				}
				return showError(data.message || "发送失败");
			}

			textEl.value = "";
			countEl.textContent = "0";
			state.selectedFiles = [];
			renderPreview();

			state.thread = data.thread;
			state.limits = data.limits || state.limits;
			state.usage = data.usage || state.usage;

			renderStatus();
			renderRemain();
			renderMessages(data.messages);
			setInputDisabled(false);
		} catch {
			showError("网络异常，发送失败。");
		}
	});

	async function openFeedbackModal() {
		setModal(true);

		/**
		 * 如果上一次打开时看到“已关闭”，用户再次点“联系管理员”才新开会话。
		 */
		const shouldStartNew = state.closedSeen === true;
		await loadThread(shouldStartNew);
	}

	openBtn.addEventListener("click", openFeedbackModal);

	// 从消息中心点击“管理员回复”后会跳到 /#feedback，这里自动打开反馈对话框。
	if (window.location.hash === "#feedback") {
		setTimeout(openFeedbackModal, 120);
	}

	function closeModal() {
		setModal(false);
	}

	closeBtn.addEventListener("click", closeModal);
	mask.addEventListener("click", closeModal);
})();
