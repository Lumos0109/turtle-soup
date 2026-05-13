document.addEventListener("DOMContentLoaded", () => {
	const main = document.querySelector("main[data-room-code]");
	if (!main) return;
	const roomCode = main.dataset.roomCode;
	const api = `/rooms/${roomCode}`;

	function initMobileViewportFix() {
		const root = document.documentElement;
		let raf = 0;

		function applyViewportVars() {
			raf = 0;
			const vv = window.visualViewport;
			const height = Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight);
			const width = Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth);
			root.style.setProperty("--app-height", `${height}px`);
			root.style.setProperty("--app-width", `${width}px`);
			if (vv) {
				const keyboardInset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
				root.style.setProperty("--keyboard-inset", `${keyboardInset}px`);
			}
		}

		function scheduleViewportSync() {
			if (raf) cancelAnimationFrame(raf);
			raf = requestAnimationFrame(applyViewportVars);
		}

		scheduleViewportSync();
		window.visualViewport?.addEventListener("resize", scheduleViewportSync);
		window.visualViewport?.addEventListener("scroll", scheduleViewportSync);
		window.addEventListener("resize", scheduleViewportSync);
		window.addEventListener("orientationchange", () => setTimeout(scheduleViewportSync, 250));

		document.addEventListener("focusin", (e) => {
			if (!e.target.matches("input, textarea, select")) return;
			document.body.classList.add("mobile-keyboard-active");
			setTimeout(() => {
				scheduleViewportSync();

				const form = e.target.closest("form");
				if (e.target.id === "chatInput" && form) {
					form.scrollIntoView({ block: "end", inline: "nearest" });
					return;
				}

				e.target.scrollIntoView({ block: "center", inline: "nearest" });
			}, 220);
		});

		document.addEventListener("focusout", () => {
			setTimeout(() => {
				document.body.classList.remove("mobile-keyboard-active");
				scheduleViewportSync();
			}, 180);
		});
	}

	initMobileViewportFix();

	let state = null;
	let currentSoupId = null;
	let historyFilter = "all";
	let selectedRatingScore = 0;
	let leavingByBackButton = false;
	let soupSurfaceExpanded = false;
	let lastHistorySignature = "";
	let lastChatSignature = "";
	let lastStickerSignature = "";
	let editingQuestionId = null;

	const $ = (id) => document.getElementById(id);
	const toastEl = $("roomToast");

	function toast(message) {
		if (!toastEl) return alert(message);
		toastEl.textContent = message;
		toastEl.classList.remove("opacity-0");
		toastEl.classList.add("opacity-100");
		clearTimeout(toastEl._timer);
		toastEl._timer = setTimeout(() => {
			toastEl.classList.add("opacity-0");
			toastEl.classList.remove("opacity-100");
		}, 1800);
	}

	function esc(str) {
		return String(str || "")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}

	function eventsSignature(events) {
		return (events || []).map((e) => [
			e.id,
			e.type,
			e.questionId || "",
			e.answer || "",
			e.content || "",
			(e.images || []).join(","),
			e.createdAt || "",
		].join("\u001f")).join("\u001e");
	}

	function resetRenderCache() {
		lastHistorySignature = "";
		lastChatSignature = "";
		lastStickerSignature = "";
	}

	async function postJson(url, body = {}) {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.message || "操作失败");
		return data;
	}

	async function copyText(text) {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return;
		}
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.left = "-9999px";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		document.body.removeChild(ta);
		if (!ok) throw new Error("copy failed");
	}

	function openModal(id) {
		const el = $(id);
		if (!el) return;
		el.classList.remove("hidden");
		el.classList.add("flex");
	}

	function closeModal(id) {
		const el = $(id);
		if (!el) return;
		el.classList.add("hidden");
		el.classList.remove("flex");
	}

	function iconSvg(kind) {
		if (kind === "yes") return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
		if (kind === "no") return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`;
		if (kind === "irrelevant") return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>`;
		if (kind === "partial") return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="9" x2="15" y1="15" y2="9"/></svg>`;
		if (kind === "hint") return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
		return `<span class="font-mono text-xs">？</span>`;
	}

	function answerMeta(answer, type) {
		if (type === "hint") return { text: "提示", icon: iconSvg("hint"), cls: "room-answer-hint" };
		if (!answer) return { text: "待回答", icon: iconSvg("pending"), cls: "room-answer-pending" };
		if (answer === "yes") return { text: "是", icon: iconSvg("yes"), cls: "room-answer-yes" };
		if (answer === "no") return { text: "否", icon: iconSvg("no"), cls: "room-answer-no" };
		if (answer === "partial") return { text: "是也不是", icon: iconSvg("partial"), cls: "room-answer-partial" };
		return { text: "无关", icon: iconSvg("irrelevant"), cls: "room-answer-irrelevant" };
	}

	function shouldShowHistoryEvent(event) {
		if (event.type === "hint") return historyFilter === "all" || historyFilter === "hint";
		if (event.type === "question") {
			if (historyFilter === "all") return true;
			if (historyFilter === "pending") return !event.answer;
			return event.answer === historyFilter;
		}
		return false;
	}

	function answerButtons(questionId, currentAnswer = null) {
		if (!state?.viewer?.isHost) return "";
		const btn = (answer, text) => {
			const active = currentAnswer === answer ? "border-black bg-black text-white" : "border bg-white/60 hover:border-black";
			return `<button class="room-answer-btn rounded-full px-2 py-1 ${active}" data-question-id="${questionId}" data-answer="${answer}" type="button">${text}</button>`;
		};
		return `
			<div class="mt-2 flex flex-wrap gap-1 font-mono text-xs">
				${btn("yes", "是")}
				${btn("no", "否")}
				${btn("partial", "是也不是")}
				${btn("irrelevant", "无关")}
			</div>`;
	}

	function historyHostActions(event) {
		if (!state?.viewer?.isHost) return "";
		const edit = event.type === "question"
			? `<button class="room-edit-answer-btn rounded-full border border-neutral-300 bg-white/70 px-2 py-1 hover:border-black" data-question-id="${event.questionId}" data-question-content="${esc(event.content)}" type="button">修改回答</button>`
			: "";
		return `
			<div class="mt-2 flex flex-wrap gap-1 font-mono text-xs">
				${edit}
				<button class="room-delete-history-btn rounded-full border border-red-200 bg-white/70 px-2 py-1 text-red-600 hover:border-red-600" data-event-id="${event.id}" type="button">删除记录</button>
			</div>`;
	}

	function renderHistory() {
		const list = $("historyList");
		if (!list || !state) return;
		const items = state.events.filter(shouldShowHistoryEvent);
		const sig = `${historyFilter}|host=${state.viewer?.isHost ? 1 : 0}|${eventsSignature(items)}`;
		if (sig === lastHistorySignature) return;
		lastHistorySignature = sig;
		if (items.length === 0) {
			list.innerHTML = `<div class="py-8 text-center font-mono text-xs text-neutral-400">暂无记录</div>`;
			return;
		}
		list.innerHTML = items.map((e) => {
			const meta = answerMeta(e.answer, e.type);
			const images = (e.images || []).map((src) => `<img src="${esc(src)}" class="mt-2 max-h-40 rounded-lg border border-neutral-200" alt="提示图片">`).join("");
			return `
				<div class="rounded-xl border p-3 ${meta.cls}">
					<div class="flex items-start gap-2">
						<span class="room-history-icon">${meta.icon}</span>
						<div class="min-w-0 flex-1">
							<div class="font-mono text-xs opacity-70">${esc(meta.text)} · ${esc(e.username)} · ${esc(e.createdAt)}</div>
							<div class="mt-1 whitespace-pre-wrap text-sm leading-relaxed">${esc(e.content)}</div>
							${images}
							${e.type === "question" ? answerButtons(e.questionId, e.answer) : ""}
							${historyHostActions(e)}
						</div>
					</div>
				</div>`;
		}).join("");
	}

	function renderChat() {
		const list = $("chatList");
		if (!list || !state) return;
		const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
		const events = state.events;
		const sig = `host=${state.viewer?.isHost ? 1 : 0}|${eventsSignature(events)}`;
		if (sig === lastChatSignature) return;
		lastChatSignature = sig;
		if (events.length === 0) {
			list.innerHTML = `<div class="py-10 text-center font-mono text-xs text-neutral-400">还没有讨论内容</div>`;
			return;
		}
		list.innerHTML = events.map((e) => {
			let label = "系统";
			let cls = "border-neutral-200 bg-white";
			if (e.type === "join") label = "进入";
			if (e.type === "leave") label = "离开";
			if (e.type === "chat") label = "讨论";
			if (e.type === "question") {
				const meta = answerMeta(e.answer, "question");
				label = e.answer ? `提问 · ${meta.text}` : "提问 · 待回答";
				cls = meta.cls;
			}
			if (e.type === "answer") {
				const meta = answerMeta(e.answer, "question");
				label = `回答 · ${meta.text}`;
				cls = meta.cls;
			}
			if (e.type === "hint") {
				label = "提示";
				cls = "room-answer-hint";
			}
			if (e.type === "sticker") {
				label = "表情";
				cls = "border-neutral-200 bg-white";
			}
			if (e.type === "start") label = "开汤";
			if (e.type === "finish") label = "完结";
			if (e.type === "reset") label = "结束";
			const images = (e.images || []).map((src) => `<img src="${esc(src)}" class="mt-2 max-h-36 rounded-lg border border-neutral-200" alt="提示图片">`).join("");
			const body = e.type === "sticker"
				? `<img src="${esc(e.content)}" class="room-sticker-img mt-2" alt="表情">`
				: `<div class="mt-1 whitespace-pre-wrap text-sm leading-relaxed">${esc(e.content)}</div>`;
			return `
				<div class="rounded-xl border p-3 ${cls}">
					<div class="font-mono text-[11px] text-neutral-500">${esc(label)} · ${esc(e.username)} · ${esc(e.createdAt)}</div>
					${body}
					${images}
					${e.type === "question" && !e.answer ? answerButtons(e.questionId) : ""}
				</div>`;
		}).join("");
		if (atBottom) list.scrollTop = list.scrollHeight;
	}

	function renderStickers() {
		const list = $("stickerList");
		if (!list || !state) return;
		const stickers = state.stickers || [];
		const sig = stickers.map((sticker) => `${sticker.id}:${sticker.url}:${sticker.name || ""}`).join("|");
		if (sig === lastStickerSignature) return;
		lastStickerSignature = sig;
		if (stickers.length === 0) {
			list.innerHTML = `<div class="py-10 text-center font-mono text-xs text-neutral-400">暂无表情，请管理员先在后台上传</div>`;
			return;
		}
		list.innerHTML = `<div class="grid grid-cols-3 gap-3 sm:grid-cols-4">${stickers.map((sticker) => `
			<button class="room-sticker-choice" data-sticker-id="${sticker.id}" type="button" title="${esc(sticker.name || "表情")}">
				<img src="${esc(sticker.url)}" class="room-sticker-img" alt="${esc(sticker.name || "表情")}">
			</button>`).join("")}</div>`;
	}

	function renderMembers() {
		if (!state) return;
		const hostSeat = $("hostSeat");
		const memberList = $("memberList");
		const memberCount = $("memberCount");
		const online = state.members.filter((m) => m.online);
		const isHost = !!state.viewer?.isHost;
		if (memberCount) memberCount.textContent = `${online.length} / ${state.limits.maxMembers}`;
		if (hostSeat) {
			const canSitOrLeave = isHost || !state.host;
			hostSeat.innerHTML = `
				<div class="flex items-center justify-between gap-3">
					<div class="min-w-0">
						<div class="font-mono text-xs text-neutral-500">主持人位</div>
						<div class="mt-1 truncate">${state.host ? `<span class="font-bold">${esc(state.host.username)}</span>` : `<span class="text-neutral-400">空</span>`}</div>
					</div>
					${canSitOrLeave ? `<button id="seatHostActionBtn" class="room-tooltip shrink-0 rounded-full border border-neutral-300 bg-white px-3 py-1.5 font-mono text-xs hover:border-black hover:bg-black hover:text-white" data-tip="${isHost ? "离开主持人位" : "坐上主持人位"}" type="button">${isHost ? "离" : "坐"}</button>` : `<span class="shrink-0 font-mono text-xs text-neutral-400">已占用</span>`}
				</div>`;
		}
		if (memberList) {
			memberList.innerHTML = state.members.map((m) => `
				<div class="flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2 text-sm ${m.online ? "" : "opacity-45"}">
					<span>${esc(m.username)}</span>
					<span class="font-mono text-xs text-neutral-500">${m.role === "host" ? "主持人" : "旁观席"}${m.online ? "" : " · 离线"}</span>
				</div>`).join("");
		}
	}

	function renderSoupTags(soup) {
		const wrap = $("roomSoupTags");
		if (!wrap) return;
		const tags = soup?.tags || [];
		if (!tags.length) {
			wrap.classList.add("hidden");
			wrap.innerHTML = "";
			return;
		}
		wrap.classList.remove("hidden");
		wrap.innerHTML = tags.slice(0, 8).map((tag) => `<span class="room-tag-chip">${esc(tag)}</span>`).join("");
	}

	function renderSoup() {
		if (!state) return;
		const soup = state.soup;
		currentSoupId = soup?.id || null;
		const waiting = $("soupWaiting");
		const playing = $("soupPlaying");
		const title = $("roomSoupTitle");
		const surface = $("roomSoupSurface");
		const bottom = $("roomSoupBottom");
		const manual = $("roomHostManual");
		const finishedPanel = $("finishedPanel");
		const finishedBottom = $("finishedBottom");
		const detailLink = $("roomSoupDetailLink");

		if (!soup) {
			if (title) title.textContent = "待主持人选汤ing";
			renderSoupTags(null);
			waiting?.classList.remove("hidden");
			playing?.classList.add("hidden");
			return;
		}
		if (title) title.textContent = soup.title;
		renderSoupTags(soup);
		if (surface) surface.textContent = soup.surface || "";
		waiting?.classList.add("hidden");
		playing?.classList.remove("hidden");
		if (detailLink) detailLink.href = `/soups/${soup.id}`;

		if (bottom) bottom.textContent = soup.bottom || "主持人可见，完结后公开";
		if (manual) manual.textContent = soup.hostManual || "暂无主持人手册";

		if (state.room.status === "finished") {
			finishedPanel?.classList.remove("hidden");
			if (finishedBottom) finishedBottom.textContent = soup.bottom || "";
		} else {
			finishedPanel?.classList.add("hidden");
		}
	}

	function renderControls() {
		if (!state) return;
		const isHost = !!state.viewer?.isHost;
		document.querySelectorAll(".host-only").forEach((el) => el.classList.toggle("hidden", !isHost));
		$("finishSoupBtn")?.classList.toggle("hidden", !isHost || !state.room.soupId || state.room.status === "finished");
		$("openHintModalBtn")?.classList.toggle("hidden", !isHost || state.room.status !== "playing");
		$("openBottomModalBtn")?.classList.toggle("hidden", !isHost || !state.room.soupId);
		$("openManualModalBtn")?.classList.toggle("hidden", !isHost || !state.room.soupId || !state.soup?.hasHostManual);
		$("resetRoomBtn")?.classList.toggle("hidden", !isHost);
		const hostItems = Array.from(document.querySelectorAll("#featureMenu .host-only"));
		const anyVisible = hostItems.some((el) => !el.classList.contains("hidden"));
		$("featureMenuEmpty")?.classList.toggle("hidden", anyVisible);
	}

	function syncSurfaceToggle() {
		const wrap = $("soupSurfaceWrap");
		const btn = $("toggleSoupSurfaceBtn");
		wrap?.classList.toggle("hidden", !soupSurfaceExpanded || !state?.soup);
		$("expandIcon")?.classList.toggle("hidden", soupSurfaceExpanded);
		$("collapseIcon")?.classList.toggle("hidden", !soupSurfaceExpanded);
		if (btn) {
			btn.setAttribute("aria-expanded", soupSurfaceExpanded ? "true" : "false");
			btn.dataset.tip = soupSurfaceExpanded ? "收起汤面" : "展开汤面";
			btn.setAttribute("aria-label", soupSurfaceExpanded ? "收起汤面" : "展开汤面");
		}
	}

	function renderAll() {
		renderMembers();
		renderSoup();
		renderControls();
		syncSurfaceToggle();
		renderHistory();
		renderChat();
		renderStickers();
	}

	async function refreshState(silent = true) {
		try {
			const res = await fetch(`${api}/state`);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				if (data.roomCode) {
					window.location.href = `/rooms/${data.roomCode}`;
					return;
				}
				throw new Error(data.message || "刷新房间失败");
			}
			state = data;
			renderAll();
		} catch (error) {
			if (!silent) toast(error.message);
		}
	}

	async function doPost(url, body, message) {
		try {
			await postJson(url, body);
			if (message) toast(message);
			await refreshState();
		} catch (error) {
			toast(error.message);
		}
	}

	$("copyRoomLinkBtn")?.addEventListener("click", async () => {
		try {
			await copyText(window.location.href);
			toast("房间链接已复制");
		} catch (_) {
			toast("复制失败，请手动复制地址栏链接");
		}
	});
	async function leaveCurrentRoomAndGo() {
		leavingByBackButton = true;
		try {
			await postJson(`${api}/presence`, { action: "leave" });
		} catch (_) {}
		window.location.href = "/rooms";
	}

	$("backToRoomsBtn")?.addEventListener("click", leaveCurrentRoomAndGo);
	$("exitCurrentRoomBtn")?.addEventListener("click", leaveCurrentRoomAndGo);
	$("toggleSoupSurfaceBtn")?.addEventListener("click", () => {
		soupSurfaceExpanded = !soupSurfaceExpanded;
		syncSurfaceToggle();
	});
	$("featureMenuBtn")?.addEventListener("click", (e) => {
		e.stopPropagation();
		$("featureMenu")?.classList.toggle("hidden");
	});
	document.addEventListener("click", (e) => {
		if (!e.target.closest("#featureMenu") && !e.target.closest("#featureMenuBtn")) $("featureMenu")?.classList.add("hidden");
	});

	$("openSeatsBtn")?.addEventListener("click", () => openModal("seatsModal"));
	$("openQuestionModalBtn")?.addEventListener("click", () => openModal("questionModal"));
	$("openHistoryModalBtn")?.addEventListener("click", () => openModal("historyModal"));
	$("openStickerModalBtn")?.addEventListener("click", () => openModal("stickerModal"));
	$("openHintModalBtn")?.addEventListener("click", () => { $("featureMenu")?.classList.add("hidden"); openModal("hintModal"); });
	$("openBottomModalBtn")?.addEventListener("click", () => { $("featureMenu")?.classList.add("hidden"); openModal("bottomModal"); });
	$("openManualModalBtn")?.addEventListener("click", () => { $("featureMenu")?.classList.add("hidden"); openModal("manualModal"); });
	$("finishSoupBtn")?.addEventListener("click", () => { $("featureMenu")?.classList.add("hidden"); doPost(`${api}/finish`, {}, "完结撒花！"); });
	$("resetRoomBtn")?.addEventListener("click", () => {
		$("featureMenu")?.classList.add("hidden");
		if (!confirm("确认结束本局并清空讨论区、提问和提示吗？")) return;
		doPost(`${api}/reset`, {}, "本局已结束，历史已清空");
	});
	document.querySelectorAll(".close-modal").forEach((btn) => {
		btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
	});
	document.querySelectorAll(".fixed.inset-0").forEach((modal) => {
		modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(modal.id); });
	});

	document.addEventListener("click", (e) => {
		const seatBtn = e.target.closest("#seatHostActionBtn");
		if (!seatBtn || !state) return;
		if (state.viewer?.isHost) doPost(`${api}/leave-host`, {}, "已离开主持人位");
		else doPost(`${api}/sit-host`, {}, "你已经坐到主持人位");
	});

	$("stickerList")?.addEventListener("click", async (e) => {
		const btn = e.target.closest(".room-sticker-choice");
		if (!btn) return;
		const stickerId = Number(btn.dataset.stickerId);
		if (!Number.isFinite(stickerId)) return;
		await doPost(`${api}/sticker`, { stickerId });
		closeModal("stickerModal");
	});

	$("questionForm")?.addEventListener("submit", async (e) => {
		e.preventDefault();
		const input = $("questionInput");
		const content = input.value.trim();
		if (!content) return toast("问题不能为空");
		await doPost(`${api}/question`, { content }, "已提交问题，等待主持人回答");
		input.value = "";
		closeModal("questionModal");
	});

	$("chatForm")?.addEventListener("submit", async (e) => {
		e.preventDefault();
		const input = $("chatInput");
		const content = input.value.trim();
		if (!content) return;
		await doPost(`${api}/chat`, { content });
		input.value = "";
	});

	$("hintForm")?.addEventListener("submit", async (e) => {
		e.preventDefault();
		const form = e.currentTarget;
		const input = $("hintInput");
		const fileInput = $("hintImages");
		const fd = new FormData(form);
		try {
			const res = await fetch(`${api}/hint`, { method: "POST", body: fd });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.message || "发送提示失败");
			toast("提示已发送");
			input.value = "";
			fileInput.value = "";
			closeModal("hintModal");
			await refreshState();
		} catch (error) {
			toast(error.message);
		}
	});

	document.addEventListener("click", (e) => {
		const answerBtn = e.target.closest(".room-answer-btn");
		if (answerBtn) {
			const questionId = Number(answerBtn.dataset.questionId);
			const answer = answerBtn.dataset.answer;
			doPost(`${api}/answer`, { questionId, answer }, "已回答");
			return;
		}
		const deleteBtn = e.target.closest(".room-delete-history-btn");
		if (deleteBtn) {
			const eventId = Number(deleteBtn.dataset.eventId);
			if (!Number.isFinite(eventId)) return;
			if (!confirm("确认删除这条历史记录吗？提问记录会连同对应回答一起删除。")) return;
			doPost(`${api}/history/${eventId}/delete`, {}, "已删除记录");
			return;
		}
		const editBtn = e.target.closest(".room-edit-answer-btn");
		if (editBtn) {
			editingQuestionId = Number(editBtn.dataset.questionId);
			$("editAnswerQuestionText").textContent = editBtn.dataset.questionContent || "";
			openModal("editAnswerModal");
			return;
		}
		const filterBtn = e.target.closest(".room-filter-chip");
		if (filterBtn) {
			historyFilter = filterBtn.dataset.historyFilter || "all";
			document.querySelectorAll(".room-filter-chip").forEach((btn) => {
				btn.classList.toggle("is-active", btn === filterBtn);
			});
			lastHistorySignature = "";
			renderHistory();
		}
	});

	document.querySelectorAll(".edit-answer-choice").forEach((btn) => {
		btn.addEventListener("click", async () => {
			if (!Number.isFinite(editingQuestionId)) return;
			await doPost(`${api}/answer`, { questionId: editingQuestionId, answer: btn.dataset.answer }, "已修改回答");
			editingQuestionId = null;
			closeModal("editAnswerModal");
		});
	});

	// 选汤弹窗
	const pickerModal = $("soupPickerModal");
	function openPicker() {
		$("featureMenu")?.classList.add("hidden");
		pickerModal?.classList.remove("hidden");
		pickerModal?.classList.add("flex");
		searchSoups();
	}
	function closePicker() {
		pickerModal?.classList.add("hidden");
		pickerModal?.classList.remove("flex");
	}
	$("openSoupPickerBtn")?.addEventListener("click", openPicker);
	$("closeSoupPickerBtn")?.addEventListener("click", closePicker);
	pickerModal?.addEventListener("click", (e) => { if (e.target === pickerModal) closePicker(); });

	function renderTagChipsFromString(tagNames) {
		const tags = String(tagNames || "").split("、").map((x) => x.trim()).filter(Boolean);
		if (!tags.length) return "";
		return `<div class="mt-2 flex flex-wrap gap-1.5">${tags.slice(0, 8).map((t) => `<span class="room-tag-chip">${esc(t)}</span>`).join("")}</div>`;
	}

	async function searchSoups() {
		const q = $("pickerQ")?.value.trim() || "";
		const sort = $("pickerSort")?.value || "";
		const tags = Array.from(document.querySelectorAll(".pickerTag")).filter((c) => c.checked).map((c) => c.value).join(",");
		const params = new URLSearchParams({ q, sort, tags });
		const resultEl = $("pickerResults");
		resultEl.innerHTML = `<div class="py-8 text-center font-mono text-xs text-neutral-400">搜索中…</div>`;
		try {
			const res = await fetch(`${api}/search-soups?${params.toString()}`);
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.message || "搜索失败");
			if (!data.soups || data.soups.length === 0) {
				resultEl.innerHTML = `<div class="py-8 text-center font-mono text-xs text-neutral-400">没有找到海龟汤</div>`;
				return;
			}
			resultEl.innerHTML = data.soups.map((s) => `
				<div class="rounded-xl border border-neutral-200 p-4 hover:border-black">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="font-serif text-lg font-bold">${esc(s.title)}</div>
							${renderTagChipsFromString(s.tag_names)}
							<div class="mt-1 line-clamp-2 text-sm text-neutral-600">${esc(s.surface)}</div>
							<div class="mt-2 font-mono text-xs text-neutral-400">作者：${esc(s.author_name)} · ❤ ${Number(s.like_count || 0)} · ${s.rating_count ? `★ ${Number(s.rating_avg || 0).toFixed(1)}` : "暂无评分"}</div>
						</div>
						<button class="picker-start-btn btn-sketch-primary shrink-0" data-soup-id="${s.id}" type="button">开汤</button>
					</div>
				</div>`).join("");
		} catch (error) {
			resultEl.innerHTML = `<div class="py-8 text-center font-mono text-xs text-red-500">${esc(error.message)}</div>`;
		}
	}
	$("pickerSearchBtn")?.addEventListener("click", searchSoups);
	$("pickerQ")?.addEventListener("keydown", (e) => { if (e.key === "Enter") searchSoups(); });
	document.querySelectorAll(".pickerTag").forEach((el) => el.addEventListener("change", searchSoups));
	$("pickerSort")?.addEventListener("change", searchSoups);
	$("pickerResults")?.addEventListener("click", async (e) => {
		const btn = e.target.closest(".picker-start-btn");
		if (!btn) return;
		await doPost(`${api}/start`, { soupId: Number(btn.dataset.soupId) }, "开汤啦");
		closePicker();
		soupSurfaceExpanded = true;
		syncSurfaceToggle();
	});

	// 完结后互动
	async function revealCurrentSoup() {
		if (!currentSoupId) throw new Error("还没有开汤");
		await fetch(`/soups/${currentSoupId}/reveal`, { method: "POST" }).catch(() => {});
	}
	$("roomLikeBtn")?.addEventListener("click", async () => {
		try {
			await revealCurrentSoup();
			const res = await fetch(`/soups/${currentSoupId}/like`, { method: "POST" });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.message || "点赞失败");
			toast("点赞成功");
			await refreshState();
		} catch (error) { toast(error.message); }
	});
	$("roomCommentBtn")?.addEventListener("click", async () => {
		try { await revealCurrentSoup(); } catch (_) {}
		if (currentSoupId) window.open(`/soups/${currentSoupId}#discussion`, "_blank", "noopener");
	});

	const ratingModal = $("roomRatingModal");	
	function renderRatingStars() {
		document.querySelectorAll(".room-rating-star").forEach((btn) => {
			const active = Number(btn.dataset.score) <= selectedRatingScore;
			btn.classList.toggle("text-yellow-500", active);
			btn.classList.toggle("text-neutral-300", !active);
		});
		$("roomRatingText").textContent = selectedRatingScore ? `${selectedRatingScore} 分` : "请选择评分";
		$("submitRoomRatingBtn").disabled = !selectedRatingScore;
	}
	$("roomRateBtn")?.addEventListener("click", () => {
		selectedRatingScore = 0;
		renderRatingStars();
		ratingModal?.classList.remove("hidden");
		ratingModal?.classList.add("flex");
	});
	$("closeRoomRatingBtn")?.addEventListener("click", () => {
		ratingModal?.classList.add("hidden");
		ratingModal?.classList.remove("flex");
	});
	document.querySelectorAll(".room-rating-star").forEach((btn) => btn.addEventListener("click", () => {
		selectedRatingScore = Number(btn.dataset.score);
		renderRatingStars();
	}));
	$("submitRoomRatingBtn")?.addEventListener("click", async () => {
		if (!currentSoupId || !selectedRatingScore) return;
		try {
			await revealCurrentSoup();
			const res = await fetch(`/soups/${currentSoupId}/rating`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ score: selectedRatingScore }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.message || "打分失败");
			toast("已完成打分，如有建议，欢迎留言哦，作者会收到消息的~");
			ratingModal?.classList.add("hidden");
			ratingModal?.classList.remove("flex");
			await refreshState();
		} catch (error) { toast(error.message); }
	});

	window.addEventListener("beforeunload", () => {
		if (leavingByBackButton) return;
		try {
			const data = new Blob([JSON.stringify({ action: "leave" })], { type: "application/json" });
			navigator.sendBeacon(`${api}/presence`, data);
		} catch (_) {}
	});

	refreshState(false);
	setInterval(() => refreshState(true), 2000);
	setInterval(() => postJson(`${api}/presence`, { action: "heartbeat" }).catch(() => {}), 15000);
});