export function initSharePopover({
  getState,
  getCurrentWorkspace,
  getEditor,
  positionPopover,
  showToast,
  escapeHtml,
}) {
  const $ = (id) => document.getElementById(id);
  let shareScope = "page";

  const isLocalHost = () => {
    const h = window.location.hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "0.0.0.0";
  };

  const getPublicOrigin = () => {
    if (!isLocalHost()) return window.location.origin;
    const saved = (localStorage.getItem("notion_public_url") || "").trim().replace(/\/+$/, "");
    return saved || window.location.origin;
  };

  const getKey = () => `notion_shared_${getState().currentWorkspaceId || "default"}`;
  const getInvited = () => {
    try {
      return JSON.parse(localStorage.getItem(getKey()) || "[]");
    } catch {
      return [];
    }
  };

  const renderInvited = () => {
    const items = getInvited();
    const sec = $("share-invited-section");
    const list = $("share-invited-list");
    list.innerHTML = "";
    if (!items.length) {
      sec.classList.add("hidden");
      return;
    }
    sec.classList.remove("hidden");
    items.slice(0, 6).forEach((entry) => {
      const row = document.createElement("div");
      row.className = "share-invited-row";
      row.innerHTML = `<span>${escapeHtml(entry.email)}</span><span class="share-perm-badge">${escapeHtml(entry.perm)}</span>`;
      list.appendChild(row);
    });
  };

  const urlInput = $("share-public-url-input");
  if (urlInput) {
    urlInput.value = localStorage.getItem("notion_public_url") || "";
    urlInput.addEventListener("input", () => {
      localStorage.setItem("notion_public_url", urlInput.value.trim().replace(/\/+$/, ""));
    });
  }

  $("topbar-share-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const warn = $("share-local-warning");
    if (warn) warn.classList.toggle("hidden", !isLocalHost());
    renderInvited();
    positionPopover($("share-popover"), $("topbar-share-btn"), true);
    $("share-email-input").focus();
  });

  document.querySelectorAll(".share-scope-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      shareScope = btn.dataset.scope;
      document.querySelectorAll(".share-scope-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.scope === shareScope)
      );
    });
  });

  $("share-copy-link-btn").addEventListener("click", async () => {
    const st = getState();
    const origin = getPublicOrigin();
    const url = st.currentPage ? `${origin}/#page=${st.currentPage.id}` : origin;
    try {
      await navigator.clipboard.writeText(url);
      showToast(isLocalHost() && !localStorage.getItem("notion_public_url") ? "Copied local link (deploy to Render for public URL)" : "Link copied to clipboard");
    } catch {
      showToast(url);
    }
  });

  $("share-gmail-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const emailsRaw = $("share-email-input").value.trim();
    if (!emailsRaw) return;
    const perm = $("share-perm-select").value;
    const note = $("share-note-input").value.trim();
    const st = getState();
    const senderName = st.user?.name || "Someone";
    const ws = getCurrentWorkspace();
    const editor = getEditor();
    const origin = getPublicOrigin();
    const pageUrl = st.currentPage ? `${origin}/#page=${st.currentPage.id}` : origin;

    let subject = "";
    const bodyLines = [];
    if (shareScope === "workspace") {
      subject = `${senderName} shared "${ws?.name || "Notion Workspace"}" with you`;
      bodyLines.push("Hi,", "", `${senderName} invited you (${perm}) to their Notion workspace: ${ws?.name || "Workspace"}.`);
      if (note) bodyLines.push("", `Message: ${note}`);
      bodyLines.push("", `Workspace link: ${origin}`, "", "Pages included:");
      st.pages.slice(0, 20).forEach((p) => bodyLines.push(`- ${p.icon || "📄"} ${p.title || "Untitled"}`));
    } else {
      const pageTitle = st.currentPage?.title || "Untitled";
      const mdPreview = editor ? editor.toMarkdown(pageTitle).slice(0, 1200) : "";
      subject = `${senderName} shared "${pageTitle}" with you`;
      bodyLines.push("Hi,", "", `${senderName} shared a Notion page with you (${perm}): ${pageTitle}`);
      if (note) bodyLines.push("", `Message: ${note}`);
      bodyLines.push("", `Link: ${pageUrl}`, "", "--- Page Preview ---", mdPreview);
    }

    const mailtoHref = `mailto:${encodeURIComponent(emailsRaw)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
    window.location.href = mailtoHref;

    const existing = getInvited();
    emailsRaw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((em) => {
        const idx = existing.findIndex((i) => i.email.toLowerCase() === em.toLowerCase());
        if (idx !== -1) existing.splice(idx, 1);
        existing.unshift({ email: em, perm, at: Date.now() });
      });
    localStorage.setItem(getKey(), JSON.stringify(existing.slice(0, 20)));
    $("share-email-input").value = "";
    $("share-note-input").value = "";
    renderInvited();
    showToast("Opened email compose");
  });
}
