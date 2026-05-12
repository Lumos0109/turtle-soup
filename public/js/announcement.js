document.addEventListener("DOMContentLoaded", () => {
  const dataEl = document.getElementById("announcementData");

  let announcements = [];
  try {
    announcements = dataEl ? JSON.parse(dataEl.textContent || "[]") : [];
  } catch {
    announcements = [];
  }

  const modal = document.getElementById("annModal");
  const modalTitle = document.getElementById("annModalTitle");
  const modalContent = document.getElementById("annModalContent");
  const closeBtn = document.getElementById("annCloseBtn");
  const mask = document.getElementById("annMask");

  const historyBtn = document.getElementById("annHistoryBtn");
  const panel = document.getElementById("annHistoryPanel");
  const list = document.getElementById("annHistoryList");
  const prevBtn = document.getElementById("annPrevBtn");
  const nextBtn = document.getElementById("annNextBtn");
  const pageText = document.getElementById("annPageText");

  let page = 1;
  const pageSize = 5;

  function findAnnouncementById(id) {
    return announcements.find((a) => String(a.id) === String(id));
  }

  function openModal(title, content) {
    if (!modal) return;
    modalTitle.textContent = title || "公告";
    modalContent.textContent = content || "暂无公告内容。";
    modal.classList.remove("hidden");
  }

  function closeModal() {
    if (modal) modal.classList.add("hidden");
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[m]));
  }

  // 首页当前公告：点击“公告：标题”直接显示当前公告完整内容
  document.querySelectorAll(".announcement-open").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const item = findAnnouncementById(id);

      if (item) {
        openModal(item.title, item.content);
        return;
      }

      openModal("公告", "暂无公告内容。");
    });
  });

  function renderHistory() {
    if (!list) return;

    const totalPages = Math.max(1, Math.ceil(announcements.length / pageSize));
    page = Math.min(Math.max(page, 1), totalPages);

    const start = (page - 1) * pageSize;
    const rows = announcements.slice(start, start + pageSize);

    list.innerHTML = rows.length
      ? rows.map((a) => `
          <button
            type="button"
            class="ann-history-item block w-full text-left border border-neutral-200 bg-white px-3 py-2 font-mono text-xs hover:border-black"
            data-id="${a.id}"
          >
            ${a.is_active ? "[当前] " : ""}${escapeHtml(a.title)}
          </button>
        `).join("")
      : `<div class="text-center text-neutral-400 font-mono text-xs py-3">暂无历史公告</div>`;

    list.querySelectorAll(".ann-history-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = findAnnouncementById(btn.getAttribute("data-id"));
        if (item) openModal(item.title, item.content);
      });
    });

    if (pageText) pageText.textContent = `${page} / ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }

  if (historyBtn && panel) {
    historyBtn.addEventListener("click", () => {
      panel.classList.toggle("hidden");
      renderHistory();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      page -= 1;
      renderHistory();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      page += 1;
      renderHistory();
    });
  }

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (mask) mask.addEventListener("click", closeModal);
});