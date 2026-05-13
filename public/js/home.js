/**
 * 首页筛选交互（稳定版）
 * - 点击筛选图标：展开/收起面板
 * - 多选标签 -> 确认：写入隐藏 input(tags) 并提交
 * - chips：hover 出现 ×，点击删除并提交
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

	if (
		!filterBtn ||
		!filterPanel ||
		!applyBtn ||
		!tagsInput ||
		!sortInput ||
		!form
	)
		return;

	function getCheckedTagIds() {
		return Array.from(document.querySelectorAll(".tagCheck"))
			.filter((c) => c.checked)
			.map((c) => c.value);
	}

	function togglePanel() {
		filterPanel.classList.toggle("hidden");
	}
	function closePanel() {
		filterPanel.classList.add("hidden");
	}

	// ✅ 点击筛选按钮：展开/收起（阻止冒泡，避免 document click 立刻关闭）
	filterBtn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		togglePanel();
	});

	// ✅ 点面板内部不冒泡
	filterPanel.addEventListener("click", (e) => e.stopPropagation());

	function renderHideReadButton() {
		if (!hideReadInput || !hideReadBtn) return;

		const enabled = hideReadInput.value === "1";
		hideReadBtn.classList.toggle("bg-black", enabled);
		hideReadBtn.classList.toggle("text-white", enabled);

		if (hideReadIcon) {
			hideReadIcon.textContent = enabled ? "✓" : "";
		}
	}

	// 清空
	if (clearBtn) {
		clearBtn.addEventListener("click", () => {
			document
				.querySelectorAll(".tagCheck")
				.forEach((c) => (c.checked = false));
			tagsInput.value = "";

			if (hideReadInput) {
				hideReadInput.value = "";
			}

			renderHideReadButton();
			form.submit();
		});
	}

	function nextHotSort(cur) {
		// 非热度排序 -> hot_desc -> hot_asc -> 默认
		if (cur !== "hot_desc" && cur !== "hot_asc") return "hot_desc";
		if (cur === "hot_desc") return "hot_asc";
		return "";
	}

	function nextRatingSort(cur) {
		// 非评分排序 -> rating_desc -> rating_asc -> 默认
		if (cur !== "rating_desc" && cur !== "rating_asc") return "rating_desc";
		if (cur === "rating_desc") return "rating_asc";
		return "";
	}

	function renderHotSortText(val) {
		if (val === "hot_desc") return "热度↓";
		if (val === "hot_asc") return "热度↑";
		return "默认";
	}

	function renderRatingSortText(val) {
		if (val === "rating_desc") return "评分↓";
		if (val === "rating_asc") return "评分↑";
		return "默认";
	}

	function renderSortButtons() {
		const val = (sortInput.value || "").trim();
		if (sortText) sortText.textContent = renderHotSortText(val);
		if (ratingSortText) ratingSortText.textContent = renderRatingSortText(val);
	}

	if (sortBtn && sortText) {
		sortBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const cur = (sortInput.value || "").trim();
			sortInput.value = nextHotSort(cur);
			renderSortButtons();
		});
	}

	if (ratingSortBtn && ratingSortText) {
		ratingSortBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const cur = (sortInput.value || "").trim();
			sortInput.value = nextRatingSort(cur);
			renderSortButtons();
		});
	}

	if (hideReadBtn && hideReadInput) {
		hideReadBtn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();

			hideReadInput.value = hideReadInput.value === "1" ? "" : "1";
			renderHideReadButton();
		});
	}

	// 确认应用
	applyBtn.addEventListener("click", () => {
		tagsInput.value = getCheckedTagIds().join(",");
		form.submit();
	});

	// chip 删除
	document.querySelectorAll(".chip-remove").forEach((btn) => {
		btn.addEventListener("click", () => {
			const removeId = btn.getAttribute("data-tag-id");
			const current = (tagsInput.value || "").split(",").filter(Boolean);
			tagsInput.value = current.filter((x) => x !== String(removeId)).join(",");
			form.submit();
		});
	});

	// 点击其他区域收起
	document.addEventListener("click", (e) => {
		const target = e.target;
		if (!filterBtn.contains(target) && !filterPanel.contains(target))
			closePanel();
	});
});
