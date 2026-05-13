document.addEventListener("DOMContentLoaded", () => {
	const openBtns = document.querySelectorAll("[data-open-feedback]");
	const modal = document.getElementById("feedbackModal");
	const closeBtn = document.getElementById("closeFeedbackBtn");
	const form = document.getElementById("feedbackForm");
	const content = document.getElementById("feedbackContent");
	const submitBtn = document.getElementById("submitFeedbackBtn");
	const status = document.getElementById("feedbackStatus");

	if (!modal || !form || !content || !submitBtn) return;

	function openModal() {
		modal.classList.remove("hidden");
		modal.classList.add("flex");
		content.focus();
		status.textContent = "";
	}

	function closeModal() {
		modal.classList.add("hidden");
		modal.classList.remove("flex");
		status.textContent = "";
	}

	openBtns.forEach((btn) => {
		btn.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();

			const supportPanel = document.getElementById("siteSupportPanel");
			const supportBtn = document.getElementById("siteSupportBtn");

			if (supportPanel) supportPanel.classList.add("hidden");
			if (supportBtn) supportBtn.setAttribute("aria-expanded", "false");

			openModal();
		});
	});

	closeBtn?.addEventListener("click", closeModal);

	modal.addEventListener("click", (event) => {
		if (event.target === modal) closeModal();
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !modal.classList.contains("hidden")) {
			closeModal();
		}
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();

		const text = content.value.trim();
		if (!text) {
			status.textContent = "请输入内容";
			status.className = "mt-3 font-mono text-xs text-red-600";
			return;
		}

		submitBtn.disabled = true;
		submitBtn.textContent = "发送中…";
		status.textContent = "";

		try {
			const response = await fetch("/feedback", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ content: text }),
			});

			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(data.message || "发送失败，请稍后再试");
			}

			content.value = "";
			status.textContent = "已发送，感谢反馈！";
			status.className = "mt-3 font-mono text-xs text-green-700";

			window.setTimeout(closeModal, 900);
		} catch (error) {
			status.textContent = error.message || "发送失败，请稍后再试";
			status.className = "mt-3 font-mono text-xs text-red-600";
		} finally {
			submitBtn.disabled = false;
			submitBtn.textContent = "发送";
		}
	});
});