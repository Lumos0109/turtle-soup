(function () {
	const toastEl = document.getElementById("nb-toast");
	let timer = null;

	function toast(msg) {
		if (!toastEl) return;
		toastEl.textContent = msg;
		toastEl.style.opacity = "1";
		clearTimeout(timer);
		timer = setTimeout(() => (toastEl.style.opacity = "0"), 1800);
	}

	function key(id) { return `hgt_revealed_${id}`; }
	function hasRevealed(id) { return sessionStorage.getItem(key(id)) === "1"; }
	function setRevealed(id) { sessionStorage.setItem(key(id), "1"); }

	function escapeHtml(str) {
		return String(str)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}


	function initMobileModalLock() {
		let scrollY = 0;
		const modalSelector = '.fixed.inset-0, #fbModal';

		function hasOpenModal() {
			return Array.from(document.querySelectorAll(modalSelector)).some((el) => {
				if (!el.id && !el.classList.contains('fixed')) return false;
				const style = getComputedStyle(el);
				return !el.classList.contains('hidden') && style.display !== 'none' && style.visibility !== 'hidden';
			});
		}

		function lock() {
			if (document.body.classList.contains('modal-open')) return;
			scrollY = window.scrollY || document.documentElement.scrollTop || 0;
			document.body.style.top = `-${scrollY}px`;
			document.body.classList.add('modal-open');
		}

		function unlock() {
			if (!document.body.classList.contains('modal-open')) return;
			document.body.classList.remove('modal-open');
			document.body.style.top = '';
			window.scrollTo(0, scrollY);
		}

		function sync() {
			if (hasOpenModal()) lock(); else unlock();
		}

		const observer = new MutationObserver(sync);
		observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
		document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setTimeout(sync, 0); });
		window.addEventListener('pageshow', unlock);
	}

	function initHostManualModal() {
		const modal = document.getElementById("hostManualModal");
		const openBtns = document.querySelectorAll(".js-host-manual-btn");
		const closeBtns = document.querySelectorAll(".js-host-manual-close");
		if (!modal || openBtns.length === 0) return;

		function openModal() {
			modal.classList.remove("hidden");
			modal.classList.add("flex");
		}

		function closeModal() {
			modal.classList.add("hidden");
			modal.classList.remove("flex");
		}

		openBtns.forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				openModal();
			});
		});

		closeBtns.forEach((btn) => btn.addEventListener("click", closeModal));
		modal.addEventListener("click", (e) => {
			if (e.target === modal) closeModal();
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") closeModal();
		});
	}

	function initDetailFlip() {
		const root = document.querySelector(".js-flip-root");
		if (!root) return;

		const soupId = root.getAttribute("data-soup-id");
		const inner = root.querySelector(".js-flip-inner");
		const faces = root.querySelectorAll(".soup-face");
		const frontFace = faces[0];
		const backFace = faces[1];
		if (backFace) backFace.style.pointerEvents = "none";

		const locked = document.querySelector(".js-discussion-locked");
		const discussion = document.querySelector(".js-discussion");
		const likeBtn = root.querySelector(".js-like-btn");
		const shareBtns = document.querySelectorAll(".js-share-btn");
		const rateBtn = document.querySelector(".js-rate-btn");
		const ratingModal = document.getElementById("ratingModal");
		const ratingStarsWrap = document.getElementById("ratingStars");
		const ratingStarBtns = ratingStarsWrap ? ratingStarsWrap.querySelectorAll(".js-rating-star") : [];
		const ratingSubmitBtn = document.getElementById("ratingSubmitBtn");
		const ratingSelectedText = document.getElementById("ratingSelectedText");
		const ratingHint = document.querySelector(".js-rating-hint");

		function setupReplyButtons() {
			const form = document.getElementById("commentForm");
			if (!form) return;
			const parentInput = document.getElementById("commentParentId");
			const hint = document.getElementById("replyHint");
			const hintText = document.getElementById("replyHintText");
			const cancelBtn = document.getElementById("cancelReplyBtn");
			const textarea = form.querySelector("textarea");

			document.querySelectorAll(".comment-reply-btn").forEach((btn) => {
				if (btn.dataset.bound === "1") return;
				btn.dataset.bound = "1";
				btn.addEventListener("click", () => {
					const id = btn.getAttribute("data-comment-id");
					const username = btn.getAttribute("data-username") || "该用户";
					if (parentInput) parentInput.value = id;
					if (hintText) hintText.textContent = `正在回复 @${username}`;
					if (hint) hint.classList.remove("hidden");
					if (textarea) {
						textarea.placeholder = `回复 @${username}（300字以内）`;
						textarea.focus();
					}
					form.scrollIntoView({ behavior: "smooth", block: "center" });
				});
			});

			if (cancelBtn && cancelBtn.dataset.bound !== "1") {
				cancelBtn.dataset.bound = "1";
				cancelBtn.addEventListener("click", () => {
					if (parentInput) parentInput.value = "";
					if (hint) hint.classList.add("hidden");
					if (textarea) textarea.placeholder = "请输入留言内容（300字以内）";
				});
			}
		}

		function renderComment(c, data) {
			const isDeleted = Number(c.is_deleted) === 1;
			const isPinned = Number(c.is_pinned) === 1;
			const currentUserId = data.currentUserId ? Number(data.currentUserId) : null;
			const soupAuthorId = data.soupAuthorId ? Number(data.soupAuthorId) : null;
			const userId = c.user_id ? Number(c.user_id) : null;

			const item = document.createElement("div");
			item.className = `border border-neutral-200 bg-white p-4 ${c.parent_id ? "ml-6 border-l-4" : ""} ${isPinned ? "border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)]" : ""}`;
			item.setAttribute("data-comment-id", c.id);

			const pinLabel = isPinned ? `<span class="mr-2 border border-black px-1 text-black">置顶</span>` : "";
			const replyLabel = c.parent_id && c.parent_username ? ` <span class="text-neutral-400">回复 @${escapeHtml(c.parent_username)}</span>` : "";
			const contentHtml = isDeleted
				? `<div class="mt-2 whitespace-pre-wrap text-neutral-400 italic">（该留言已删除）</div>`
				: `<div class="mt-2 whitespace-pre-wrap text-neutral-800">${escapeHtml(c.content || "")}</div>`;

			let actions = "";
			if (data.canPost && !isDeleted) {
				actions += `<button type="button" class="comment-reply-btn underline" data-comment-id="${c.id}" data-username="${escapeHtml(c.username || "Unknown")}">回复</button>`;
				if (currentUserId && currentUserId === userId) {
					actions += `
						<form method="post" action="/soups/${soupId}/comments/${c.id}/delete" onsubmit="return confirm('确认删除这条留言吗？');">
							<button type="submit" class="underline">删除</button>
						</form>`;
				}
				if (currentUserId && soupAuthorId && currentUserId === soupAuthorId) {
					actions += `
						<form method="post" action="/soups/${soupId}/comments/${c.id}/pin">
							<button type="submit" class="underline">${isPinned ? "取消置顶" : "置顶"}</button>
						</form>`;
				}
			}

			item.innerHTML = `
				<div class="flex items-center justify-between gap-3 text-xs font-mono text-neutral-500">
					<span>${pinLabel}${escapeHtml(c.username || "Unknown")}${replyLabel}</span>
					<span>${escapeHtml(c.created_at || "")}</span>
				</div>
				${contentHtml}
				${actions ? `<div class="mt-3 flex justify-end gap-3 font-mono text-xs">${actions}</div>` : ""}
			`;
			return item;
		}

		async function loadCommentsAfterReveal(force) {
			const list = document.getElementById("commentList");
			const badge = document.getElementById("commentCountBadge");
			if (!list) return;

			// 已有服务端直出的留言时，只绑定回复按钮，不重复拉取。
			if (!force && list.children && list.children.length > 0) {
				setupReplyButtons();
				return;
			}

			try {
				const res = await fetch(`/soups/${soupId}/comments`);
				const data = await res.json().catch(() => ({}));

				if (!res.ok) return toast(data.message || "加载留言失败");
				if (badge) badge.textContent = `留言(${data.commentCount})`;

				list.innerHTML = "";
				if (!data.comments || data.comments.length === 0) {
					list.innerHTML = `<div class="text-center text-neutral-400 italic font-mono text-xs">暂无留言</div>`;
					return;
				}

				data.comments.forEach((c) => list.appendChild(renderComment(c, data)));
				setupReplyButtons();
			} catch {
				toast("网络异常，加载留言失败。");
			}
		}

		function syncDiscussion(revealed) {
			if (!locked || !discussion) return;
			if (revealed) {
				locked.classList.add("hidden");
				discussion.classList.remove("hidden");
			} else {
				locked.classList.remove("hidden");
				discussion.classList.add("hidden");
			}
		}

		syncDiscussion(hasRevealed(soupId));
		if (hasRevealed(soupId)) loadCommentsAfterReveal();

		function toggleFlip() {
			const flipped = inner.classList.contains("rotate-y-180-state");
			if (flipped) {
				inner.classList.remove("rotate-y-180-state");
				inner.style.transform = "rotateY(0deg)";
				if (frontFace) frontFace.style.pointerEvents = "auto";
				if (backFace) backFace.style.pointerEvents = "none";
			} else {
				inner.classList.add("rotate-y-180-state");
				inner.style.transform = "rotateY(180deg)";
				if (frontFace) frontFace.style.pointerEvents = "none";
				if (backFace) backFace.style.pointerEvents = "auto";
				setRevealed(soupId);
				syncDiscussion(true);
				fetch(`/soups/${soupId}/reveal`, { method: "POST" }).catch(() => {});
				loadCommentsAfterReveal();
			}
		}

		inner.style.transform = "rotateY(0deg)";
		inner.style.transition = "transform 0.7s";
		inner.classList.add("transform-style-3d");

		let startX = 0;
		let startY = 0;
		let moved = false;

		root.addEventListener("pointerdown", (e) => {
			startX = e.clientX;
			startY = e.clientY;
			moved = false;
		});

		root.addEventListener("pointermove", (e) => {
			const dx = Math.abs(e.clientX - startX);
			const dy = Math.abs(e.clientY - startY);
			if (dx > 8 || dy > 8) moved = true;
		});

		root.addEventListener("click", (e) => {
			if (e.target && e.target.closest("button, form, a")) return;
			if (moved) return;
			toggleFlip();
		});

		if (likeBtn) {
			likeBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				if (!hasRevealed(soupId)) return toast("请先查看汤底，再点赞。");
				try {
					const res = await fetch(`/soups/${soupId}/like`, { method: "POST" });
					const data = await res.json().catch(() => ({}));
					if (!res.ok) return toast(data.message || "点赞失败");
					const el = root.querySelector(".js-like-count-2");
					if (el && typeof data.likeCount === "number") el.textContent = String(data.likeCount);
					likeBtn.disabled = true;
					toast("点赞成功");
				} catch {
					toast("网络异常，点赞失败。");
				}
			});
		}

		if (shareBtns.length > 0) {
			shareBtns.forEach((shareBtn) => {
				shareBtn.addEventListener("click", async (e) => {
					e.preventDefault();
					e.stopPropagation();

					const path = shareBtn.getAttribute("data-share-path") || window.location.pathname;
					const url = new URL(path, window.location.origin).href;

					try {
						if (navigator.clipboard && window.isSecureContext) {
							await navigator.clipboard.writeText(url);
						} else {
							const textarea = document.createElement("textarea");
							textarea.value = url;
							textarea.setAttribute("readonly", "");
							textarea.style.position = "fixed";
							textarea.style.left = "-9999px";
							textarea.style.top = "-9999px";

							document.body.appendChild(textarea);
							textarea.focus();
							textarea.select();

							const ok = document.execCommand("copy");
							document.body.removeChild(textarea);

							if (!ok) throw new Error("copy failed");
						}

						toast("已复制链接，分享给小伙伴吧~");
					} catch {
						toast("复制失败，请手动复制地址栏链接");
					}
				});
			});
		}


		function openRatingModal() {
			if (!ratingModal) return;
			const previousScore = Number(rateBtn?.dataset.userScore || ratingStarsWrap?.dataset.currentScore || 0);
			if (ratingHint) ratingHint.classList.toggle("hidden", !previousScore);
			setSelectedRating(previousScore || 0);
			ratingModal.classList.remove("hidden");
			ratingModal.classList.add("flex");
			document.body.classList.add("overflow-hidden");
		}

		function closeRatingModal() {
			if (!ratingModal) return;
			ratingModal.classList.add("hidden");
			ratingModal.classList.remove("flex");
			document.body.classList.remove("overflow-hidden");
		}

		let selectedRatingScore = Number(ratingStarsWrap?.dataset.currentScore || 0) || 0;

		function paintRatingStars(score) {
			ratingStarBtns.forEach((btn) => {
				const currentScore = Number(btn.dataset.score || 0);
				const active = score && currentScore <= score;
				btn.classList.toggle("text-black", !!active);
				btn.classList.toggle("text-neutral-300", !active);
			});
		}

		function setSelectedRating(score) {
			selectedRatingScore = Number(score || 0);
			paintRatingStars(selectedRatingScore);

			if (ratingSelectedText) {
				ratingSelectedText.textContent = selectedRatingScore
					? `${selectedRatingScore} 分（${selectedRatingScore / 2} 颗星）`
					: "请选择评分";
			}

			if (ratingSubmitBtn) ratingSubmitBtn.disabled = !selectedRatingScore;
		}

		function updateRatingSummary(data) {
			const avg = data && data.ratingAvg !== null && data.ratingAvg !== undefined ? Number(data.ratingAvg) : null;
			const count = data ? Number(data.ratingCount || 0) : 0;
			const summaryText = document.getElementById("ratingSummaryText");
			const countText = document.getElementById("ratingCountText");

			if (summaryText) {
				summaryText.textContent = count > 0 && Number.isFinite(avg) ? `${avg.toFixed(1)} 分` : "暂无评分";
			}

			if (countText) {
				countText.textContent = count > 0 ? `${count} 人打分` : "还没人打分";
			}
		}

		if (rateBtn && ratingModal && ratingStarsWrap) {
			rateBtn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();

				if (Number(rateBtn.dataset.userScore || 0) > 0) {
					toast("你已经给这个汤打过分了哦，再次打分会覆盖上一次打分情况~");
				}

				openRatingModal();
			});

			document.querySelectorAll(".js-rating-close").forEach((btn) => {
				btn.addEventListener("click", closeRatingModal);
			});

			ratingModal.addEventListener("click", (e) => {
				if (e.target === ratingModal) closeRatingModal();
			});

			ratingStarBtns.forEach((btn) => {
				const score = Number(btn.dataset.score || 0);
				btn.addEventListener("mouseenter", () => paintRatingStars(score));
				btn.addEventListener("focus", () => paintRatingStars(score));
				btn.addEventListener("mouseleave", () => paintRatingStars(selectedRatingScore));
				btn.addEventListener("blur", () => paintRatingStars(selectedRatingScore));
				btn.addEventListener("click", () => setSelectedRating(score));
			});

			if (ratingSubmitBtn) {
				ratingSubmitBtn.addEventListener("click", async () => {
					if (!selectedRatingScore) return toast("请选择评分");

					ratingSubmitBtn.disabled = true;
					try {
						const res = await fetch(`/soups/${soupId}/rating`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ score: selectedRatingScore }),
						});

						const data = await res.json().catch(() => ({}));
						if (!res.ok) return toast(data.message || "打分失败");

						rateBtn.dataset.userScore = String(data.userScore || selectedRatingScore);
						ratingStarsWrap.dataset.currentScore = String(data.userScore || selectedRatingScore);
						setSelectedRating(Number(data.userScore || selectedRatingScore));
						updateRatingSummary(data);
						closeRatingModal();
						toast("已完成打分，如有建议，欢迎留言哦，作者会收到消息的~");
					} catch {
						toast("网络异常，打分失败。");
					} finally {
						ratingSubmitBtn.disabled = !selectedRatingScore;
					}
				});
			}

			setSelectedRating(selectedRatingScore);
		}

		const form = document.querySelector(".js-comment-form");
		if (form) {
			setupReplyButtons();
			form.addEventListener("submit", (e) => {
				if (!hasRevealed(soupId)) {
					e.preventDefault();
					return toast("请先查看汤底，再留言。");
				}
				const textarea = form.querySelector("textarea");
				const val = textarea ? textarea.value.trim() : "";
				if (!val) {
					e.preventDefault();
					return toast("留言内容不能为空。");
				}
				if (val.length > 300) {
					e.preventDefault();
					return toast("留言最多 300 字。");
				}
			});
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			initMobileModalLock();
	initHostManualModal();
			initDetailFlip();
		});
	} else {
		initMobileModalLock();
	initHostManualModal();
		initDetailFlip();
	}
})();
