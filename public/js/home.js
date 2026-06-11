/**
 * 首页筛选交互
 * - 点击筛选图标：展开/收起面板
 * - 多选标签 -> 确认：写入隐藏 input(tags) 并提交
 * - 热度/评分排序按钮：循环切换排序状态
 * - 隐藏已读：登录用户可用
 * - chips：点击 × 删除标签并提交
 */

document.addEventListener("DOMContentLoaded", () => {
	const filterBtn = document.getElementById("filterBtn");
	const filterPanel = document.getElementById("filterPanel");
	const applyBtn = document.getElementById("filterApplyBtn");
	const clearBtn = document.getElementById("filterClearBtn");
	const tagsInput = document.getElementById("tagsInput");
	const form = document.getElementById("homeSearchForm");

	const sortInput = document.getElementById("sortInput");
	const sortBtn = document.getElementById("sortBtn");
	const sortText = document.getElementById("sortText");
	const ratingSortBtn = document.getElementById("ratingSortBtn");
	const ratingSortText = document.getElementById("ratingSortText");

	const hideReadInput = document.getElementById("hideReadInput");
	const hideReadBtn = document.getElementById("hideReadBtn");
	const hideReadIcon = document.getElementById("hideReadIcon");
	const favoriteOnlyInput = document.getElementById("favoriteOnlyInput");
	const favoriteOnlyBtn = document.getElementById("favoriteOnlyBtn");
	const favoriteOnlyIcon = document.getElementById("favoriteOnlyIcon");

	if (!filterBtn || !filterPanel || !applyBtn || !tagsInput || !sortInput || !form) return;

	function getCheckedTagIds() {
		return Array.from(document.querySelectorAll(".tagCheck"))
			.filter((checkbox) => checkbox.checked)
			.map((checkbox) => checkbox.value);
	}

	function togglePanel() {
		const willOpen = filterPanel.classList.contains("hidden");
		filterPanel.classList.toggle("hidden", !willOpen);
		filterBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
	}

	function closePanel() {
		filterPanel.classList.add("hidden");
		filterBtn.setAttribute("aria-expanded", "false");
	}

	function renderHideReadButton() {
		if (!hideReadInput || !hideReadBtn) return;
		const enabled = hideReadInput.value === "1";
		hideReadBtn.classList.toggle("bg-black", enabled);
		hideReadBtn.classList.toggle("text-white", enabled);
		hideReadBtn.classList.toggle("border-black", enabled);
		if (hideReadIcon) hideReadIcon.textContent = enabled ? "✓" : "";
	}

	function renderFavoriteOnlyButton() {
		if (!favoriteOnlyInput || !favoriteOnlyBtn) return;
		const enabled = favoriteOnlyInput.value === "1";
		favoriteOnlyBtn.classList.toggle("bg-black", enabled);
		favoriteOnlyBtn.classList.toggle("text-white", enabled);
		favoriteOnlyBtn.classList.toggle("border-black", enabled);
		if (favoriteOnlyIcon) favoriteOnlyIcon.textContent = enabled ? "✓" : "";
	}

	function nextHotSort(cur) {
		if (cur !== "hot_desc" && cur !== "hot_asc") return "hot_desc";
		if (cur === "hot_desc") return "hot_asc";
		return "";
	}

	function nextRatingSort(cur) {
		if (cur !== "rating_desc" && cur !== "rating_asc") return "rating_desc";
		if (cur === "rating_desc") return "rating_asc";
		return "";
	}

	function renderHotSortText(val) {
		if (val === "hot_desc") return "热度↓";
		if (val === "hot_asc") return "热度↑";
		return "热度";
	}

	function renderRatingSortText(val) {
		if (val === "rating_desc") return "评分↓";
		if (val === "rating_asc") return "评分↑";
		return "评分";
	}

	function renderSortButtons() {
		const val = (sortInput.value || "").trim();
		if (sortText) sortText.textContent = renderHotSortText(val);
		if (ratingSortText) ratingSortText.textContent = renderRatingSortText(val);
	}

	filterBtn.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		togglePanel();
	});

	filterPanel.addEventListener("click", (event) => event.stopPropagation());

	if (clearBtn) {
		clearBtn.addEventListener("click", () => {
			document.querySelectorAll(".tagCheck").forEach((checkbox) => {
				checkbox.checked = false;
			});
			tagsInput.value = "";
			sortInput.value = "";
			if (hideReadInput) hideReadInput.value = "";
			if (favoriteOnlyInput) favoriteOnlyInput.value = "";
			renderHideReadButton();
			renderFavoriteOnlyButton();
			renderSortButtons();
			form.submit();
		});
	}

	if (sortBtn && sortText) {
		sortBtn.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			sortInput.value = nextHotSort((sortInput.value || "").trim());
			renderSortButtons();
		});
	}

	if (ratingSortBtn && ratingSortText) {
		ratingSortBtn.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			sortInput.value = nextRatingSort((sortInput.value || "").trim());
			renderSortButtons();
		});
	}

	if (hideReadBtn && hideReadInput) {
		hideReadBtn.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			hideReadInput.value = hideReadInput.value === "1" ? "" : "1";
			renderHideReadButton();
		});
	}

	if (favoriteOnlyBtn && favoriteOnlyInput) {
		favoriteOnlyBtn.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			favoriteOnlyInput.value = favoriteOnlyInput.value === "1" ? "" : "1";
			tagsInput.value = getCheckedTagIds().join(",");
			renderFavoriteOnlyButton();
			form.submit();
		});
	}

	applyBtn.addEventListener("click", () => {
		tagsInput.value = getCheckedTagIds().join(",");
		form.submit();
	});

	document.querySelectorAll(".chip-remove").forEach((btn) => {
		btn.addEventListener("click", () => {
			const removeId = btn.getAttribute("data-tag-id");
			const current = (tagsInput.value || "").split(",").filter(Boolean);
			tagsInput.value = current.filter((id) => id !== String(removeId)).join(",");
			form.submit();
		});
	});

	document.addEventListener("click", (event) => {
		const target = event.target;
		if (!filterBtn.contains(target) && !filterPanel.contains(target)) closePanel();
	});


	const HOME_RETURN_KEY = "hgtHomeReturnState";
	const HOME_RESTORE_FLAG = "hgtHomeRestoreScroll";

	function currentHomeUrl() {
		return window.location.pathname + window.location.search;
	}

	function saveHomeReturnState() {
		try {
			window.localStorage.setItem(HOME_RETURN_KEY, JSON.stringify({
				url: currentHomeUrl(),
				scrollY: Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0)),
				time: Date.now(),
			}));
		} catch (_) {}
	}

	function restoreHomeScrollIfNeeded() {
		try {
			if (window.localStorage.getItem(HOME_RESTORE_FLAG) !== "1") return;
			const raw = window.localStorage.getItem(HOME_RETURN_KEY);
			if (!raw) return;
			const saved = JSON.parse(raw);
			if (!saved || saved.url !== currentHomeUrl()) return;
			window.localStorage.removeItem(HOME_RESTORE_FLAG);
			const y = Math.max(0, Number(saved.scrollY || 0));
			const restore = () => window.scrollTo({ top: y, left: 0, behavior: "auto" });
			restore();
			window.requestAnimationFrame(restore);
			window.setTimeout(restore, 120);
			window.setTimeout(restore, 420);
		} catch (_) {}
	}

	document.querySelectorAll("[data-home-soup-link]").forEach((link) => {
		link.addEventListener("click", saveHomeReturnState);
	});

	window.addEventListener("pagehide", saveHomeReturnState);
	restoreHomeScrollIfNeeded();

	renderHideReadButton();
	renderFavoriteOnlyButton();
	renderSortButtons();
});
