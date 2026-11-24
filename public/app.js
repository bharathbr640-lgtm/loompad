import { api } from "./api.js";
import { ICONS, hydrateIcons } from "./icons.js";
import { BlockEditor } from "./editor.js";
import { GraphView } from "./graph.js";
import { initSharePopover } from "./share.js";

const EMOJIS = [
  "📄", "📝", "👋", "🏡", "🚀", "💡", "✨",
  "📌", "📚", "🧠", "⚡", "🎯", "✅", "🔥",
  "🗓️", "💻", "🎨", "📊", "🔖", "🌱", "🗂️",
  "⌨️", "🛠️", "🌍", "🎵", "☕", "🧪", "🏆",
];

const COVERS = [
  "linear-gradient(120deg, #f6d365 0%, #fda085 100%)",
  "linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)",
  "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
  "linear-gradient(120deg, #fbc2eb 0%, #a6c1ee 100%)",
  "linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)",
  "linear-gradient(120deg, #fccb90 0%, #d57eeb 100%)",
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #2b5876 0%, #4e4376 100%)",
];

const AVATAR_COLORS = ["#2383e2", "#e16259", "#0f7b6c", "#9065b0", "#d9730d", "#ad1a72", "#37352f"];

const TEMPLATES = {
  meeting: {
    title: "Meeting Notes",
    icon: "📝",
    blocks: [
      { type: "callout", content: "Date: Today  |  Attendees: ", meta: { emoji: "🗓️" } },
      { type: "heading_2", content: "Agenda" },
      { type: "bulleted_list", content: "Topic 1" },
      { type: "bulleted_list", content: "Topic 2" },
      { type: "heading_2", content: "Action Items" },
      { type: "todo", content: "Follow up on key decisions", checked: false },
      { type: "todo", content: "Share summary notes", checked: false },
    ],
  },
  project: {
    title: "Project Database",
    icon: "📊",
    blocks: [
      { type: "callout", content: "Switch between Table, Board, List, and Gallery views below.", meta: { emoji: "🎯" } },
      {
        type: "database",
        content: "",
        meta: {
          title: "Project Tasks",
          view: "board",
          filterStatus: "All",
          sortBy: "default",
          rows: [
            { id: "r1", name: "Define scope", status: "Done", priority: "High", tag: "Planning", date: "2026-11-24" },
            { id: "r2", name: "Build core modules", status: "In Progress", priority: "High", tag: "Eng", date: "2026-11-25" },
            { id: "r3", name: "QA & ship", status: "Not Started", priority: "Medium", tag: "Release", date: "2026-11-26" },
          ],
        },
      },
    ],
  },
  todo: {
    title: "Weekly To-Do",
    icon: "✅",
    blocks: [
      { type: "heading_2", content: "Top Priorities" },
      { type: "todo", content: "Priority #1", checked: false },
      { type: "todo", content: "Priority #2", checked: false },
      { type: "divider", content: "" },
      { type: "heading_3", content: "Later this week" },
      { type: "todo", content: "Backlog item", checked: false },
    ],
  },
  reading: {
    title: "Reading List",
    icon: "📚",
    blocks: [
      {
        type: "database",
        content: "",
        meta: {
          title: "Books & Papers",
          view: "gallery",
          filterStatus: "All",
          sortBy: "default",
          rows: [
            { id: "b1", name: "Designing Data-Intensive Applications", status: "In Progress", priority: "High", tag: "Systems", date: "2026-11-24" },
            { id: "b2", name: "Systems Performance", status: "Not Started", priority: "Medium", tag: "Perf", date: "2026-11-24" },
          ],
        },
      },
    ],
  },
};

const state = {
  user: null,
  workspaces: [],
  currentWorkspaceId: null,
  pages: [],
  currentView: "page", // "page" | "home" | "graph" | "empty"
  currentPage: null,
  currentBlocks: [],
  currentChildren: [],
  currentBreadcrumbs: [],
  currentBacklinks: [],
  currentComments: [],
  expandedPages: new Set(),
  authMode: "login",
  contextPageId: null,
  searchResults: [],
  searchSelectedIdx: 0,
  searchTitleOnly: false,
  searchFavoritesOnly: false,
  saveTimer: null,
  titleTimer: null,
  tabs: [],
  activeTabId: null,
  dragPageId: null,
};

let editor = null;
let graphView = null;
const $ = (id) => document.getElementById(id);

function genTabId() {
  return "tab_" + Math.random().toString(36).slice(2, 9);
}

function showToast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 2400);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function applyTheme(theme) {
  const pref = ["light", "dark", "system"].includes(theme) ? theme : "light";
  localStorage.setItem("notion_theme", pref);
  let resolved = pref;
  if (pref === "system") {
    resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", resolved);
  const sel = $("theme-select");
  if (sel) sel.value = pref;
}

function userInitial(user) {
  if (!user) return "U";
  if (user.avatarEmoji) return user.avatarEmoji;
  return (user.name || user.email || "U").trim()[0].toUpperCase();
}

function closeAllPopovers() {
  ["workspace-popover", "trash-popover", "page-menu-popover", "emoji-popover", "cover-popover", "share-popover"].forEach((id) =>
    $(id).classList.add("hidden")
  );
}

function positionPopover(popoverEl, anchorEl, alignRight = false) {
  closeAllPopovers();
  popoverEl.classList.remove("hidden");
  const rect = anchorEl.getBoundingClientRect();
  const popRect = popoverEl.getBoundingClientRect();
  let top = rect.bottom + 6;
  if (top + popRect.height > window.innerHeight - 12) top = Math.max(12, rect.top - popRect.height - 6);
  let left = alignRight ? rect.right - popRect.width : rect.left;
  left = Math.max(12, Math.min(window.innerWidth - popRect.width - 12, left));
  popoverEl.style.top = `${top}px`;
  popoverEl.style.left = `${left}px`;
}

// ============ VIEW SWITCHER ============
function setMainView(view) {
  state.currentView = view;
  $("home-view").classList.toggle("hidden", view !== "home");
  $("graph-view").classList.toggle("hidden", view !== "graph");
  $("empty-state").classList.toggle("hidden", view !== "empty");
  $("page-scroller").classList.toggle("hidden", view !== "page");
  $("editor-topbar").classList.toggle("hidden", view !== "page");
  if (view !== "page") $("trashed-banner").classList.add("hidden");

  $("nav-home-btn").classList.toggle("active-nav", view === "home");
  $("nav-graph-btn").classList.toggle("active-nav", view === "graph");

  if (view !== "graph" && graphView) graphView.stop();
}

async function openHomeView() {
  if (!state.currentWorkspaceId) return;
  setMainView("home");
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = (state.user?.name || "").split(" ")[0];
  $("home-greeting").textContent = firstName ? `${greet}, ${firstName}` : greet;

  try {
    const data = await api.getHome(state.currentWorkspaceId);
    const grid = $("home-recent-grid");
    grid.innerHTML = "";
    (data.recentPages || []).forEach((p) => {
      const card = document.createElement("button");
      card.className = "home-page-card";
      card.innerHTML = `
        <div class="home-card-cover" style="${p.cover ? `background:${p.cover}` : ""}"></div>
        <div class="home-card-body">
          <div class="home-card-icon">${p.icon || "📄"}</div>
          <div class="home-card-title">${escapeHtml(p.title || "Untitled")}</div>
        </div>
      `;
      card.addEventListener("click", () => openPage(p.id));
      grid.appendChild(card);
    });

    const todosEl = $("home-todos-list");
    todosEl.innerHTML = "";
    if (!data.openTodos?.length) {
      todosEl.innerHTML = `<div class="trash-empty">No open to-do items across your workspace.</div>`;
    } else {
      data.openTodos.forEach((t) => {
        const row = document.createElement("button");
        row.className = "home-todo-row";
        row.innerHTML = `
          <span>☐ ${escapeHtml(t.content)}</span>
          <span class="home-todo-page">${t.pageIcon} ${escapeHtml(t.pageTitle)}</span>
        `;
        row.addEventListener("click", () => openPage(t.pageId));
        todosEl.appendChild(row);
      });
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function openGraphView() {
  if (!state.currentWorkspaceId) return;
  setMainView("graph");
  try {
    const data = await api.getGraph(state.currentWorkspaceId);
    graphView.setData(data);
  } catch (err) {
    showToast(err.message);
  }
}

// ============ DESKTOP TABS & HISTORY ============
function getActiveTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || null;
}

function ensureTabForPage(page, openInNewTab = false, pushHistory = true) {
  if (!page) return;
  if (openInNewTab || !state.tabs.length) {
    const newTab = {
      id: genTabId(),
      pageId: page.id,
      title: page.title || "Untitled",
      icon: page.icon || "📄",
      history: [page.id],
      historyIdx: 0,
    };
    state.tabs.push(newTab);
    state.activeTabId = newTab.id;
  } else {
    const tab = getActiveTab() || state.tabs[0];
    state.activeTabId = tab.id;
    if (pushHistory && tab.pageId !== page.id) {
      tab.history = tab.history.slice(0, tab.historyIdx + 1);
      tab.history.push(page.id);
      tab.historyIdx = tab.history.length - 1;
    }
    tab.pageId = page.id;
    tab.title = page.title || "Untitled";
    tab.icon = page.icon || "📄";
  }
  renderTabBar();
}

function syncTabsMetadata() {
  const byId = new Map(state.pages.map((p) => [p.id, p]));
  state.tabs.forEach((t) => {
    const p = byId.get(t.pageId);
    if (p) {
      t.title = p.title || "Untitled";
      t.icon = p.icon || "📄";
    }
  });
  renderTabBar();
}

function renderTabBar() {
  const strip = $("tabs-strip");
  strip.innerHTML = "";
  state.tabs.forEach((tab) => {
    const pill = document.createElement("div");
    pill.className = `tab-pill ${tab.id === state.activeTabId && state.currentView === "page" ? "active" : ""}`;
    pill.innerHTML = `
      <span>${tab.icon || "📄"}</span>
      <span class="tab-pill-title">${escapeHtml(tab.title || "Untitled")}</span>
    `;
    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close-btn";
    closeBtn.title = "Close tab";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    pill.appendChild(closeBtn);
    pill.addEventListener("click", async () => {
      state.activeTabId = tab.id;
      renderTabBar();
      await openPage(tab.pageId, false, { openInNewTab: false, pushHistory: false });
    });
    strip.appendChild(pill);
  });

  const active = getActiveTab();
  $("nav-back-btn").disabled = !active || active.historyIdx <= 0;
  $("nav-forward-btn").disabled = !active || active.historyIdx >= active.history.length - 1;
}

async function closeTab(tabId) {
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const wasActive = state.activeTabId === tabId;
  state.tabs.splice(idx, 1);

  if (!state.tabs.length) {
    state.activeTabId = null;
    renderTabBar();
    setMainView("empty");
    return;
  }

  if (wasActive) {
    const nextTab = state.tabs[Math.min(idx, state.tabs.length - 1)];
    state.activeTabId = nextTab.id;
    renderTabBar();
    await openPage(nextTab.pageId, false, { openInNewTab: false, pushHistory: false });
  } else {
    renderTabBar();
  }
}

async function navigateTabHistory(delta) {
  const tab = getActiveTab();
  if (!tab) return;
  const nextIdx = tab.historyIdx + delta;
  if (nextIdx < 0 || nextIdx >= tab.history.length) return;
  tab.historyIdx = nextIdx;
  tab.pageId = tab.history[nextIdx];
  renderTabBar();
  await openPage(tab.pageId, false, { openInNewTab: false, pushHistory: false });
}

// ============ AUTH ============
function renderAuthView() {
  $("auth-view").classList.remove("hidden");
  $("app-view").classList.add("hidden");
  const isReg = state.authMode === "register";
  $("auth-title").textContent = isReg ? "Create your Notion account" : "Log in";
  $("auth-subtitle").textContent = isReg
    ? "Start organizing your workspace locally with zero external integrations."
    : "Enter your account details to access your workspace.";
  $("auth-name-group").classList.toggle("hidden", !isReg);
  $("auth-submit").textContent = isReg ? "Create account" : "Continue";
  $("auth-switch-text").textContent = isReg ? "Already have an account?" : "Don't have an account?";
  $("auth-switch-btn").textContent = isReg ? "Log in" : "Create an account";
  $("auth-error").classList.add("hidden");
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const name = $("auth-name").value.trim();
  const errEl = $("auth-error");
  errEl.classList.add("hidden");

  try {
    const res =
      state.authMode === "register"
        ? await api.register({ email, password, name })
        : await api.login({ email, password });
    state.user = res.user;
    state.workspaces = res.workspaces || [];
    state.currentWorkspaceId = state.workspaces[0]?.id || null;
    state.tabs = [];
    state.activeTabId = null;
    $("auth-password").value = "";
    await enterApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
}

// ============ APP BOOTSTRAP ============
async function enterApp() {
  $("auth-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  applyTheme(state.user?.theme || "light");
  renderUserUI();
  renderWorkspaceHeader();
  await loadWorkspacePages();

  const hashMatch = window.location.hash.match(/^#page=([^&]+)/);
  const hashPage = hashMatch ? state.pages.find((p) => p.id === hashMatch[1]) : null;
  const firstPage = hashPage || state.pages.find((p) => !p.parentId) || state.pages[0];
  if (firstPage) {
    await openPage(firstPage.id, false, { openInNewTab: true, pushHistory: false });
  } else {
    setMainView("empty");
  }
}

function renderUserUI() {
  const u = state.user;
  if (!u) return;
  const init = userInitial(u);
  ["sidebar-user-avatar", "settings-tab-avatar", "settings-avatar-preview"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.textContent = init;
    el.style.backgroundColor = u.avatarColor || "#2383e2";
  });
  $("sidebar-user-name").textContent = u.name || "User";
  $("sidebar-user-email").textContent = u.email || "";
  $("pop-account-email").textContent = u.email || "";
}

function getCurrentWorkspace() {
  return state.workspaces.find((w) => w.id === state.currentWorkspaceId) || state.workspaces[0] || null;
}

function renderWorkspaceHeader() {
  const ws = getCurrentWorkspace();
  if (!ws) return;
  $("ws-name").textContent = ws.name;
  $("ws-avatar").textContent = ws.icon || ws.name[0]?.toUpperCase() || "N";
}

// ============ PAGES TREE (with Drag-and-Drop Nesting) ============
async function loadWorkspacePages() {
  if (!state.currentWorkspaceId) return;
  const res = await api.listPages(state.currentWorkspaceId, false);
  state.pages = res.pages || [];
  renderSidebarTrees();
  syncTabsMetadata();
}

function renderSidebarTrees() {
  const favs = state.pages.filter((p) => p.isFavorite);
  const favSection = $("favorites-section");
  const favList = $("favorites-list");
  favList.innerHTML = "";
  if (favs.length) {
    favSection.classList.remove("hidden");
    favs.forEach((p) => favList.appendChild(createPageTreeRow(p, 0, false)));
  } else {
    favSection.classList.add("hidden");
  }

  const tree = $("pages-tree");
  tree.innerHTML = "";
  const childrenByParent = new Map();
  state.pages.forEach((p) => {
    const key = p.parentId || "__root__";
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(p);
  });

  function renderBranch(parentKey, depth) {
    const list = childrenByParent.get(parentKey) || [];
    list.forEach((page) => {
      const kids = childrenByParent.get(page.id) || [];
      tree.appendChild(createPageTreeRow(page, depth, kids.length > 0));
      if (kids.length && state.expandedPages.has(page.id)) {
        renderBranch(page.id, depth + 1);
      }
    });
  }

  renderBranch("__root__", 0);
}

function createPageTreeRow(page, depth, hasChildren) {
  const row = document.createElement("div");
  row.className = `page-tree-row ${state.currentView === "page" && state.currentPage?.id === page.id ? "active" : ""}`;
  row.style.paddingLeft = `${6 + depth * 16}px`;
  row.draggable = true;

  row.addEventListener("dragstart", (e) => {
    state.dragPageId = page.id;
    e.dataTransfer.effectAllowed = "move";
  });
  row.addEventListener("dragover", (e) => {
    if (!state.dragPageId || state.dragPageId === page.id) return;
    e.preventDefault();
    row.classList.add("drag-over-row");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drag-over-row"));
  row.addEventListener("drop", async (e) => {
    row.classList.remove("drag-over-row");
    if (!state.dragPageId || state.dragPageId === page.id) return;
    e.preventDefault();
    const draggedId = state.dragPageId;
    state.dragPageId = null;
    await api.updatePage(draggedId, { parentId: page.id });
    state.expandedPages.add(page.id);
    await loadWorkspacePages();
    showToast(`Nested inside "${page.title || "Untitled"}"`);
  });

  const toggleBtn = document.createElement("button");
  toggleBtn.className = `tree-toggle ${state.expandedPages.has(page.id) ? "expanded" : ""} ${hasChildren ? "" : "empty"}`;
  toggleBtn.innerHTML = ICONS.chevronRight;
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!hasChildren) return;
    if (state.expandedPages.has(page.id)) state.expandedPages.delete(page.id);
    else state.expandedPages.add(page.id);
    renderSidebarTrees();
  });

  const iconSpan = document.createElement("span");
  iconSpan.className = "tree-page-icon";
  if (page.icon) iconSpan.textContent = page.icon;
  else iconSpan.innerHTML = ICONS.fileText;

  const titleSpan = document.createElement("span");
  titleSpan.className = "tree-page-title";
  titleSpan.textContent = page.title || "Untitled";

  const actions = document.createElement("div");
  actions.className = "tree-row-actions";

  const moreBtn = document.createElement("button");
  moreBtn.className = "tree-action-btn";
  moreBtn.title = "Delete, duplicate, and more";
  moreBtn.innerHTML = ICONS.moreHorizontal;
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openPageMenu(page, moreBtn);
  });

  const addSubBtn = document.createElement("button");
  addSubBtn.className = "tree-action-btn";
  addSubBtn.title = "Add a page inside";
  addSubBtn.innerHTML = ICONS.plus;
  addSubBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    state.expandedPages.add(page.id);
    await createAndOpenPage(page.id);
  });

  actions.append(moreBtn, addSubBtn);
  row.append(toggleBtn, iconSpan, titleSpan, actions);

  row.addEventListener("click", (e) => {
    openPage(page.id, false, { openInNewTab: e.metaKey || e.ctrlKey, pushHistory: true });
  });
  return row;
}

// ============ PAGE LOADING & RENDERING ============
async function openPage(pageId, focusTitle = false, { openInNewTab = false, pushHistory = true } = {}) {
  try {
    const data = await api.getPage(pageId);
    state.currentPage = data.page;
    state.currentBlocks = data.blocks || [];
    state.currentChildren = data.children || [];
    state.currentBreadcrumbs = data.breadcrumbs || [];
    state.currentBacklinks = data.backlinks || [];
    state.currentComments = data.comments || [];

    state.currentBreadcrumbs.forEach((b) => state.expandedPages.add(b.id));

    setMainView("page");
    ensureTabForPage(state.currentPage, openInNewTab, pushHistory);
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", `#page=${state.currentPage.id}`);
    }

    $("trashed-banner").classList.toggle("hidden", !state.currentPage.isTrashed);
    $("locked-pill").classList.toggle("hidden", !state.currentPage.isLocked);
    $("comments-panel").classList.add("hidden");

    renderBreadcrumbs();
    renderPageCanvas();
    renderTags();
    renderBacklinks();
    renderComments();
    renderSidebarTrees();

    if (focusTitle && !state.currentPage.isLocked) {
      $("page-title").focus();
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function navigateWikiLink(title) {
  const clean = (title || "").trim();
  if (!clean) return;
  const existing = state.pages.find((p) => (p.title || "").trim().toLowerCase() === clean.toLowerCase());
  if (existing) {
    await openPage(existing.id);
    return;
  }
  // Auto-create linked page if it doesn't exist yet
  const res = await api.createPage(state.currentWorkspaceId, { title: clean, icon: "📄" });
  await loadWorkspacePages();
  await openPage(res.page.id);
  showToast(`Created linked page "${clean}"`);
}

function renderBreadcrumbs() {
  const nav = $("breadcrumbs");
  nav.innerHTML = "";
  const p = state.currentPage;
  if (!p) return;

  state.currentBreadcrumbs.forEach((crumb) => {
    const btn = document.createElement("button");
    btn.className = "crumb-item";
    btn.textContent = `${crumb.icon ? crumb.icon + " " : ""}${crumb.title || "Untitled"}`;
    btn.addEventListener("click", () => openPage(crumb.id));
    nav.appendChild(btn);

    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.textContent = "/";
    nav.appendChild(sep);
  });

  const cur = document.createElement("span");
  cur.className = "crumb-item";
  cur.textContent = `${p.icon ? p.icon + " " : ""}${p.title || "Untitled"}`;
  nav.appendChild(cur);

  const favBtn = $("topbar-favorite-btn");
  favBtn.innerHTML = p.isFavorite ? ICONS.starFilled : ICONS.star;
  favBtn.title = p.isFavorite ? "Remove from Favorites" : "Add to Favorites";
}

function renderTags() {
  const list = $("tags-list");
  list.innerHTML = "";
  const tags = state.currentPage?.tags || [];
  tags.forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "page-tag-pill";
    pill.textContent = tag;
    if (!state.currentPage?.isLocked) {
      const x = document.createElement("button");
      x.type = "button";
      x.className = "tag-remove-btn";
      x.textContent = "×";
      x.addEventListener("click", async () => {
        const next = tags.filter((t) => t !== tag);
        const res = await api.updatePage(state.currentPage.id, { tags: next });
        state.currentPage.tags = res.page.tags;
        renderTags();
      });
      pill.appendChild(x);
    }
    list.appendChild(pill);
  });
  $("tag-add-input").classList.toggle("hidden", Boolean(state.currentPage?.isLocked));
}

function renderBacklinks() {
  const bar = $("backlinks-bar");
  const list = $("backlinks-list");
  list.innerHTML = "";
  if (!state.currentBacklinks.length) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  state.currentBacklinks.forEach((bl) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wiki-link-chip";
    btn.textContent = `${bl.icon || "📄"} ${bl.title}`;
    btn.addEventListener("click", () => openPage(bl.id));
    list.appendChild(btn);
  });
}

function renderComments() {
  const list = $("comments-list");
  list.innerHTML = "";
  if (!state.currentComments.length) {
    list.innerHTML = `<div class="trash-empty" style="padding:10px;">No comments yet.</div>`;
    return;
  }
  state.currentComments.forEach((c) => {
    const item = document.createElement("div");
    item.className = "comment-item";
    const timeStr = new Date(c.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    item.innerHTML = `
      <div class="comment-meta">
        <strong>${escapeHtml(c.authorName)}</strong>
        <span>${timeStr}</span>
      </div>
      <div class="comment-body">${escapeHtml(c.content)}</div>
    `;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "comment-del-btn";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      await api.deleteComment(c.id);
      state.currentComments = state.currentComments.filter((x) => x.id !== c.id);
      renderComments();
    });
    item.appendChild(del);
    list.appendChild(item);
  });
}

function isBlankPage() {
  const p = state.currentPage;
  if (!p || p.title?.trim() || p.isLocked) return false;
  if (!state.currentBlocks.length) return true;
  return state.currentBlocks.length === 1 && !state.currentBlocks[0].content?.trim() && state.currentBlocks[0].type === "paragraph";
}

function renderPageCanvas() {
  const p = state.currentPage;
  if (!p) return;

  const coverEl = $("page-cover");
  if (p.cover) {
    coverEl.classList.remove("hidden");
    coverEl.style.background = p.cover;
  } else {
    coverEl.classList.add("hidden");
  }

  const container = $("page-container");
  container.classList.toggle("full-width", Boolean(p.fullWidth));
  container.classList.toggle("small-text", Boolean(p.smallText));
  container.classList.remove("font-sans", "font-serif", "font-mono");
  container.classList.add(`font-${p.fontStyle || "sans"}`);

  const iconBtn = $("page-icon-btn");
  if (p.icon) {
    iconBtn.textContent = p.icon;
    iconBtn.classList.remove("hidden");
  } else {
    iconBtn.classList.add("hidden");
  }

  const titleEl = $("page-title");
  titleEl.textContent = p.title || "";
  titleEl.contentEditable = p.isLocked ? "false" : "true";
  document.title = p.title ? `${p.title} — Notion` : "Notion";

  $("template-bar").classList.toggle("hidden", !isBlankPage());

  const subBar = $("subpages-bar");
  subBar.innerHTML = "";
  if (state.currentChildren.length) {
    subBar.classList.remove("hidden");
    state.currentChildren.forEach((child) => {
      const chip = document.createElement("button");
      chip.className = "subpage-chip";
      chip.textContent = `${child.icon || "📄"} ${child.title || "Untitled"}`;
      chip.addEventListener("click", () => openPage(child.id));
      subBar.appendChild(chip);
    });
  } else {
    subBar.classList.add("hidden");
  }

  editor.setBlocks(state.currentBlocks, Boolean(p.isLocked));
  $("save-status").textContent = "Saved";
}

async function createAndOpenPage(parentId = null, openInNewTab = false) {
  if (!state.currentWorkspaceId) return;
  try {
    const res = await api.createPage(state.currentWorkspaceId, { parentId });
    await loadWorkspacePages();
    await openPage(res.page.id, true, { openInNewTab, pushHistory: true });
  } catch (err) {
    showToast(err.message);
  }
}

async function applyTemplate(key) {
  const tpl = TEMPLATES[key];
  if (!tpl || !state.currentPage) return;
  const pageId = state.currentPage.id;
  await api.updatePage(pageId, { title: tpl.title, icon: tpl.icon });
  await api.saveBlocks(pageId, tpl.blocks);
  await loadWorkspacePages();
  await openPage(pageId, false, { openInNewTab: false, pushHistory: false });
  showToast(`Applied "${tpl.title}" template`);
}

function scheduleSaveBlocks(blocks) {
  if (!state.currentPage) return;
  const pageId = state.currentPage.id;
  $("template-bar").classList.add("hidden");
  $("save-status").textContent = "Saving...";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      await api.saveBlocks(pageId, blocks);
      $("save-status").textContent = "Saved";
    } catch {
      $("save-status").textContent = "Save failed";
    }
  }, 450);
}

function scheduleSaveTitle(newTitle) {
  if (!state.currentPage) return;
  const pageId = state.currentPage.id;
  state.currentPage.title = newTitle;
  $("template-bar").classList.add("hidden");

  const local = state.pages.find((p) => p.id === pageId);
  if (local) local.title = newTitle;
  renderBreadcrumbs();
  renderSidebarTrees();
  syncTabsMetadata();
  document.title = newTitle ? `${newTitle} — Notion` : "Notion";

  $("save-status").textContent = "Saving...";
  clearTimeout(state.titleTimer);
  state.titleTimer = setTimeout(async () => {
    try {
      await api.updatePage(pageId, { title: newTitle });
      $("save-status").textContent = "Saved";
    } catch {
      $("save-status").textContent = "Save failed";
    }
  }, 350);
}

// ============ MARKDOWN IMPORT ============
function parseMarkdownToBlocks(mdText) {
  const lines = String(mdText || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let inCode = false;
  let codeLang = "";
  let codeBuf = [];

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", content: codeBuf.join("\n"), meta: { language: codeLang || "plain text" } });
        inCode = false;
        codeBuf = [];
        codeLang = "";
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (!line.trim()) continue;
    if (line.startsWith("### ")) blocks.push({ type: "heading_3", content: line.slice(4) });
    else if (line.startsWith("## ")) blocks.push({ type: "heading_2", content: line.slice(3) });
    else if (line.startsWith("# ")) blocks.push({ type: "heading_1", content: line.slice(2) });
    else if (line.match(/^[-*]\s+\[(x|X)\]\s+/)) blocks.push({ type: "todo", content: line.replace(/^[-*]\s+\[(x|X)\]\s+/, ""), checked: true });
    else if (line.match(/^[-*]\s+\[\s?\]\s+/)) blocks.push({ type: "todo", content: line.replace(/^[-*]\s+\[\s?\]\s+/, ""), checked: false });
    else if (line.match(/^[-*]\s+/)) blocks.push({ type: "bulleted_list", content: line.replace(/^[-*]\s+/, "") });
    else if (line.match(/^\d+\.\s+/)) blocks.push({ type: "numbered_list", content: line.replace(/^\d+\.\s+/, "") });
    else if (line.startsWith("> ")) blocks.push({ type: "quote", content: line.slice(2) });
    else if (line.trim() === "---") blocks.push({ type: "divider", content: "" });
    else blocks.push({ type: "paragraph", content: line });
  }
  return blocks.length ? blocks : [{ type: "paragraph", content: "" }];
}

// ============ PAGE MENU & ACTIONS ============
function openPageMenu(page, anchorEl, alignRight = false) {
  state.contextPageId = page.id;
  $("pm-fav-label").textContent = page.isFavorite ? "Remove from Favorites" : "Add to Favorites";
  $("pm-full-width-indicator").classList.toggle("on", Boolean(page.fullWidth));
  $("pm-small-text-indicator").classList.toggle("on", Boolean(page.smallText));
  $("pm-lock-indicator").classList.toggle("on", Boolean(page.isLocked));

  document.querySelectorAll(".font-choice").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.font === (page.fontStyle || "sans"));
  });

  const wc = state.currentPage?.id === page.id ? editor.getWordCount() : 0;
  $("pm-word-count").textContent = state.currentPage?.id === page.id ? `Word count: ${wc} words` : "Page options";
  positionPopover($("page-menu-popover"), anchorEl, alignRight);
}

function getContextPage() {
  if (!state.contextPageId) return state.currentPage;
  return state.pages.find((p) => p.id === state.contextPageId) || state.currentPage;
}

async function togglePageField(page, field) {
  const res = await api.updatePage(page.id, { [field]: !page[field] });
  const local = state.pages.find((p) => p.id === page.id);
  if (local) Object.assign(local, res.page);
  if (state.currentPage?.id === page.id) {
    Object.assign(state.currentPage, res.page);
    $("locked-pill").classList.toggle("hidden", !state.currentPage.isLocked);
    renderBreadcrumbs();
    renderPageCanvas();
    renderTags();
  }
  renderSidebarTrees();
}

async function movePageToTrash(page) {
  await api.updatePage(page.id, { isTrashed: true });
  showToast(`Moved "${page.title || "Untitled"}" to Trash`);
  state.tabs = state.tabs.filter((t) => t.pageId !== page.id);
  await loadWorkspacePages();
  if (state.currentPage?.id === page.id) {
    const next = state.pages[0];
    if (next) await openPage(next.id, false, { openInNewTab: !state.tabs.length });
    else setMainView("empty");
  }
  renderTabBar();
}

function downloadTextFile(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// ============ WORKSPACE SWITCHER ============
function openWorkspacePopover() {
  const list = $("workspace-list");
  list.innerHTML = "";
  state.workspaces.forEach((ws) => {
    const btn = document.createElement("button");
    btn.className = `popover-item ${ws.id === state.currentWorkspaceId ? "active-ws" : ""}`;
    btn.innerHTML = `
      <span class="ws-avatar">${ws.icon || ws.name[0]?.toUpperCase() || "N"}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ws.name)}</span>
      ${ws.id === state.currentWorkspaceId ? "✓" : ""}
    `;
    btn.addEventListener("click", async () => {
      state.currentWorkspaceId = ws.id;
      state.tabs = [];
      state.activeTabId = null;
      closeAllPopovers();
      renderWorkspaceHeader();
      await loadWorkspacePages();
      const first = state.pages[0];
      if (first) await openPage(first.id, false, { openInNewTab: true, pushHistory: false });
      else setMainView("empty");
    });
    list.appendChild(btn);
  });
  positionPopover($("workspace-popover"), $("workspace-switcher-btn"));
}

// ============ SEARCH MODAL ============
async function openSearchModal() {
  closeAllPopovers();
  $("search-modal").classList.remove("hidden");
  const input = $("search-input");
  input.value = "";
  input.focus();
  await runSearch("");
}

function closeSearchModal() {
  $("search-modal").classList.add("hidden");
}

async function runSearch(q) {
  if (!state.currentWorkspaceId) return;
  const res = await api.search(state.currentWorkspaceId, q, {
    titleOnly: state.searchTitleOnly,
    favoritesOnly: state.searchFavoritesOnly,
  });
  state.searchResults = res.results || [];
  state.searchSelectedIdx = 0;
  renderSearchResults();
}

function renderSearchResults() {
  const list = $("search-results");
  list.innerHTML = "";
  if (!state.searchResults.length) {
    list.innerHTML = `<div class="trash-empty">No matching pages found.</div>`;
    return;
  }
  state.searchResults.forEach((item, i) => {
    const btn = document.createElement("button");
    btn.className = `search-result-item ${i === state.searchSelectedIdx ? "selected" : ""}`;
    btn.innerHTML = `
      <span class="search-result-icon">${item.icon || "📄"}</span>
      <div class="search-result-body">
        <div class="search-result-title">${escapeHtml(item.title || "Untitled")}</div>
        ${item.breadcrumb ? `<div class="search-result-path">${escapeHtml(item.breadcrumb)}</div>` : ""}
        ${item.snippet ? `<div class="search-result-snippet">${escapeHtml(item.snippet)}</div>` : ""}
      </div>
    `;
    btn.addEventListener("click", async (e) => {
      closeSearchModal();
      await openPage(item.id, false, { openInNewTab: e.metaKey || e.ctrlKey, pushHistory: true });
    });
    list.appendChild(btn);
  });
}

// ============ SETTINGS & PROFILE MODAL ============
async function loadStorageStats() {
  const grid = $("sqlite-stats-grid");
  grid.innerHTML = `<div class="stat-card"><div class="stat-label">Loading SQLite stats...</div></div>`;
  try {
    const s = await api.storageStats();
    const kb = (s.diskUsageBytes / 1024).toFixed(1);
    const cards = [
      { label: "Database file", val: s.databaseFile },
      { label: "Disk usage", val: `${kb} KB` },
      { label: "SQLite engine", val: `v${s.sqliteVersion}` },
      { label: "Active pages", val: s.activePages },
      { label: "Total blocks", val: s.blocks },
      { label: "Active sessions", val: s.activeSessions },
    ];
    grid.innerHTML = cards
      .map((c) => `<div class="stat-card"><div class="stat-value">${escapeHtml(c.val)}</div><div class="stat-label">${c.label}</div></div>`)
      .join("");
  } catch (err) {
    grid.innerHTML = `<div class="stat-card"><div class="stat-label">${escapeHtml(err.message)}</div></div>`;
  }
}

function openSettingsModal(defaultTab = "profile") {
  closeAllPopovers();
  const u = state.user;
  const ws = getCurrentWorkspace();
  if (!u) return;

  $("settings-name-input").value = u.name || "";
  $("settings-email-input").value = u.email || "";
  $("theme-select").value = u.theme || "light";
  if (ws) {
    $("settings-ws-name").value = ws.name || "";
    $("settings-ws-icon").value = ws.icon || "";
  }
  $("profile-feedback").classList.add("hidden");
  $("password-feedback").classList.add("hidden");
  $("workspace-feedback").classList.add("hidden");
  $("current-password-input").value = "";
  $("new-password-input").value = "";

  const picker = $("avatar-color-picker");
  picker.innerHTML = "";
  AVATAR_COLORS.forEach((color) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `color-dot ${u.avatarColor === color ? "active" : ""}`;
    dot.style.backgroundColor = color;
    dot.addEventListener("click", async () => {
      const res = await api.updateProfile({ avatarColor: color });
      state.user = res.user;
      renderUserUI();
      openSettingsModal("profile");
    });
    picker.appendChild(dot);
  });

  switchSettingsTab(defaultTab);
  $("settings-modal").classList.remove("hidden");
}

function switchSettingsTab(tabName) {
  document.querySelectorAll(".settings-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
  ["profile", "preferences", "workspace", "storage"].forEach((name) => $(`tab-${name}`).classList.toggle("hidden", name !== tabName));
  if (tabName === "storage") loadStorageStats();
}

// ============ TRASH POPOVER ============
async function openTrashPopover() {
  if (!state.currentWorkspaceId) return;
  const res = await api.listPages(state.currentWorkspaceId, true);
  renderTrashList(res.pages || [], "");
  $("trash-search-input").value = "";
  $("trash-search-input").oninput = (e) => renderTrashList(res.pages || [], e.target.value.trim().toLowerCase());
  positionPopover($("trash-popover"), $("nav-trash-btn"));
}

function renderTrashList(pages, filter) {
  const list = $("trash-list");
  list.innerHTML = "";
  const filtered = filter ? pages.filter((p) => (p.title || "Untitled").toLowerCase().includes(filter)) : pages;
  if (!filtered.length) {
    list.innerHTML = `<div class="trash-empty">No pages in Trash</div>`;
    return;
  }
  filtered.forEach((p) => {
    const row = document.createElement("div");
    row.className = "trash-row";
    const title = document.createElement("span");
    title.className = "trash-row-title";
    title.textContent = `${p.icon || "📄"} ${p.title || "Untitled"}`;
    const actions = document.createElement("div");
    actions.className = "trash-row-actions";

    const restoreBtn = document.createElement("button");
    restoreBtn.className = "icon-btn-sm";
    restoreBtn.title = "Restore page";
    restoreBtn.innerHTML = ICONS.restore;
    restoreBtn.addEventListener("click", async () => {
      await api.updatePage(p.id, { isTrashed: false });
      showToast("Page restored");
      await loadWorkspacePages();
      await openTrashPopover();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn-sm danger-text";
    delBtn.title = "Delete permanently";
    delBtn.innerHTML = ICONS.trash;
    delBtn.addEventListener("click", async () => {
      await api.deletePagePermanently(p.id);
      showToast("Deleted permanently");
      await openTrashPopover();
    });

    actions.append(restoreBtn, delBtn);
    row.append(title, actions);
    list.appendChild(row);
  });
}

// ============ EMOJI & COVER PICKERS ============
function initPickers() {
  const eGrid = $("emoji-grid");
  EMOJIS.forEach((em) => {
    const btn = document.createElement("button");
    btn.className = "emoji-btn";
    btn.textContent = em;
    btn.addEventListener("click", async () => {
      if (!state.currentPage) return;
      const res = await api.updatePage(state.currentPage.id, { icon: em });
      Object.assign(state.currentPage, res.page);
      const local = state.pages.find((p) => p.id === state.currentPage.id);
      if (local) local.icon = em;
      renderBreadcrumbs();
      renderPageCanvas();
      renderSidebarTrees();
      syncTabsMetadata();
      closeAllPopovers();
    });
    eGrid.appendChild(btn);
  });

  $("emoji-remove-btn").addEventListener("click", async () => {
    if (!state.currentPage) return;
    const res = await api.updatePage(state.currentPage.id, { icon: "" });
    Object.assign(state.currentPage, res.page);
    const local = state.pages.find((p) => p.id === state.currentPage.id);
    if (local) local.icon = "";
    renderBreadcrumbs();
    renderPageCanvas();
    renderSidebarTrees();
    syncTabsMetadata();
    closeAllPopovers();
  });

  const cGrid = $("cover-grid");
  COVERS.forEach((grad) => {
    const swatch = document.createElement("div");
    swatch.className = "cover-swatch";
    swatch.style.background = grad;
    swatch.addEventListener("click", async () => {
      if (!state.currentPage) return;
      const res = await api.updatePage(state.currentPage.id, { cover: grad });
      Object.assign(state.currentPage, res.page);
      renderPageCanvas();
      closeAllPopovers();
    });
    cGrid.appendChild(swatch);
  });

  const removeCover = async () => {
    if (!state.currentPage) return;
    const res = await api.updatePage(state.currentPage.id, { cover: "" });
    Object.assign(state.currentPage, res.page);
    renderPageCanvas();
    closeAllPopovers();
  };
  $("cover-remove-btn").addEventListener("click", removeCover);
  $("remove-cover-btn").addEventListener("click", removeCover);
}

// ============ SIDEBAR RESIZE & COLLAPSE ============
function initSidebarControls() {
  const sidebar = $("sidebar");
  const openBtn = $("sidebar-open-btn");
  const collapseBtn = $("sidebar-collapse-btn");

  const toggleSidebar = () => {
    const collapsed = sidebar.classList.toggle("collapsed");
    openBtn.classList.toggle("hidden", !collapsed);
  };

  collapseBtn.addEventListener("click", toggleSidebar);
  openBtn.addEventListener("click", toggleSidebar);

  const resizer = $("sidebar-resizer");
  let resizing = false;
  resizer.addEventListener("mousedown", () => {
    resizing = true;
    document.body.style.cursor = "col-resize";
  });
  window.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const w = Math.max(200, Math.min(400, e.clientX));
    document.documentElement.style.setProperty("--sidebar-width", `${w}px`);
  });
  window.addEventListener("mouseup", () => {
    if (resizing) {
      resizing = false;
      document.body.style.cursor = "";
    }
  });

  // Drop page on "Private" header to un-nest to root
  const rootDrop = $("private-root-dropzone");
  rootDrop.addEventListener("dragover", (e) => {
    if (!state.dragPageId) return;
    e.preventDefault();
    rootDrop.classList.add("drag-over-row");
  });
  rootDrop.addEventListener("dragleave", () => rootDrop.classList.remove("drag-over-row"));
  rootDrop.addEventListener("drop", async (e) => {
    rootDrop.classList.remove("drag-over-row");
    if (!state.dragPageId) return;
    e.preventDefault();
    const draggedId = state.dragPageId;
    state.dragPageId = null;
    await api.updatePage(draggedId, { parentId: null });
    await loadWorkspacePages();
    showToast("Moved page to top level");
  });

  return toggleSidebar;
}

// ============ EVENT BINDINGS ============
function bindEvents() {
  const toggleSidebar = initSidebarControls();
  initPickers();

  // Tabs
  $("nav-back-btn").addEventListener("click", () => navigateTabHistory(-1));
  $("nav-forward-btn").addEventListener("click", () => navigateTabHistory(1));
  $("new-tab-btn").addEventListener("click", () => createAndOpenPage(null, true));

  // Home & Graph View nav
  $("nav-home-btn").addEventListener("click", openHomeView);
  $("nav-graph-btn").addEventListener("click", openGraphView);

  // Graph toolbar controls
  $("graph-search-input").addEventListener("input", (e) => graphView.setFilters({ searchQuery: e.target.value }));
  $("graph-toggle-wiki").addEventListener("change", (e) => graphView.setFilters({ showWiki: e.target.checked }));
  $("graph-toggle-hier").addEventListener("change", (e) => graphView.setFilters({ showHierarchy: e.target.checked }));
  $("graph-reset-btn").addEventListener("click", () => graphView.resetLayout());

  // Import Markdown
  $("nav-import-md-btn").addEventListener("click", () => $("import-md-input").click());
  $("import-md-input").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !state.currentWorkspaceId) return;
    const text = await file.text();
    const title = file.name.replace(/\.(md|txt)$/i, "");
    const blocks = parseMarkdownToBlocks(text);
    const res = await api.createPage(state.currentWorkspaceId, { title, icon: "📄", blocks });
    await loadWorkspacePages();
    await openPage(res.page.id);
    showToast(`Imported "${title}"`);
    e.target.value = "";
  });

  // Tags input
  $("tag-add-input").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = e.target.value.trim();
    if (!val || !state.currentPage) return;
    const next = [...new Set([...(state.currentPage.tags || []), val])];
    const res = await api.updatePage(state.currentPage.id, { tags: next });
    state.currentPage.tags = res.page.tags;
    e.target.value = "";
    renderTags();
  });

  // Comments panel
  const toggleComments = () => {
    const panel = $("comments-panel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) $("comment-input").focus();
  };
  $("topbar-comments-btn").addEventListener("click", toggleComments);
  $("add-comment-btn").addEventListener("click", toggleComments);
  $("comments-close-btn").addEventListener("click", () => $("comments-panel").classList.add("hidden"));
  $("comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const val = $("comment-input").value.trim();
    if (!val || !state.currentPage) return;
    const res = await api.addComment(state.currentPage.id, val);
    state.currentComments.push(res.comment);
    $("comment-input").value = "";
    renderComments();
  });

  // Templates
  document.querySelectorAll(".template-pill").forEach((btn) => {
    btn.addEventListener("click", () => applyTemplate(btn.dataset.template));
  });

  // Auth
  $("auth-form").addEventListener("submit", handleAuthSubmit);
  $("auth-switch-btn").addEventListener("click", () => {
    state.authMode = state.authMode === "login" ? "register" : "login";
    renderAuthView();
  });

  // Workspace switcher
  $("workspace-switcher-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openWorkspacePopover();
  });

  $("pop-create-workspace-btn").addEventListener("click", async () => {
    closeAllPopovers();
    const name = prompt("Enter a name for your new workspace:");
    if (!name || !name.trim()) return;
    const res = await api.createWorkspace({ name: name.trim() });
    state.workspaces.push(res.workspace);
    state.currentWorkspaceId = res.workspace.id;
    state.tabs = [];
    state.activeTabId = null;
    renderWorkspaceHeader();
    await loadWorkspacePages();
    const first = state.pages[0];
    if (first) await openPage(first.id, false, { openInNewTab: true, pushHistory: false });
    else setMainView("empty");
    showToast(`Created workspace "${res.workspace.name}"`);
  });

  $("pop-settings-btn").addEventListener("click", () => openSettingsModal("profile"));
  $("pop-logout-btn").addEventListener("click", doLogout);

  // Sidebar nav
  $("nav-search-btn").addEventListener("click", openSearchModal);
  $("nav-new-page-btn").addEventListener("click", () => createAndOpenPage(null));
  $("sidebar-quick-new-btn").addEventListener("click", () => createAndOpenPage(null));
  $("section-add-page-btn").addEventListener("click", () => createAndOpenPage(null));
  $("add-page-inline-btn").addEventListener("click", () => createAndOpenPage(null));
  $("empty-new-page-btn").addEventListener("click", () => createAndOpenPage(null));
  $("nav-settings-btn").addEventListener("click", () => openSettingsModal("profile"));
  $("sidebar-profile-btn").addEventListener("click", () => openSettingsModal("profile"));
  $("nav-trash-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openTrashPopover();
  });

  initSharePopover({
    getState: () => state,
    getCurrentWorkspace,
    getEditor: () => editor,
    positionPopover,
    showToast,
    escapeHtml,
  });

  // Topbar actions
  $("topbar-favorite-btn").addEventListener("click", () => {
    if (state.currentPage) togglePageField(state.currentPage, "isFavorite");
  });
  $("topbar-more-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.currentPage) openPageMenu(state.currentPage, $("topbar-more-btn"), true);
  });

  // Trashed banner
  $("restore-current-page-btn").addEventListener("click", async () => {
    if (!state.currentPage) return;
    await api.updatePage(state.currentPage.id, { isTrashed: false });
    await loadWorkspacePages();
    await openPage(state.currentPage.id);
    showToast("Page restored");
  });
  $("delete-current-page-btn").addEventListener("click", async () => {
    if (!state.currentPage) return;
    await api.deletePagePermanently(state.currentPage.id);
    await loadWorkspacePages();
    const next = state.pages[0];
    if (next) await openPage(next.id);
    else setMainView("empty");
    showToast("Page permanently deleted");
  });

  // Page header controls
  $("add-icon-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!state.currentPage?.isLocked) positionPopover($("emoji-popover"), $("add-icon-btn"));
  });
  $("page-icon-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!state.currentPage?.isLocked) positionPopover($("emoji-popover"), $("page-icon-btn"));
  });
  $("add-cover-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!state.currentPage?.isLocked) positionPopover($("cover-popover"), $("add-cover-btn"));
  });
  $("change-cover-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!state.currentPage?.isLocked) positionPopover($("cover-popover"), $("change-cover-btn"), true);
  });

  // Page title
  const titleEl = $("page-title");
  titleEl.addEventListener("input", () => {
    if (!state.currentPage?.isLocked) scheduleSaveTitle(titleEl.textContent || "");
  });
  titleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      editor.focusBlock(0, false);
    }
  });
  $("editor-bottom-pad").addEventListener("click", () => editor.appendAndFocus());

  // Page menu
  document.querySelectorAll(".font-choice").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const p = getContextPage();
      if (!p) return;
      const fontStyle = btn.dataset.font;
      const res = await api.updatePage(p.id, { fontStyle });
      const local = state.pages.find((x) => x.id === p.id);
      if (local) Object.assign(local, res.page);
      if (state.currentPage?.id === p.id) {
        Object.assign(state.currentPage, res.page);
        renderPageCanvas();
      }
      document.querySelectorAll(".font-choice").forEach((b) => b.classList.toggle("active", b.dataset.font === fontStyle));
    });
  });

  $("pm-favorite").addEventListener("click", async () => {
    const p = getContextPage();
    closeAllPopovers();
    if (p) await togglePageField(p, "isFavorite");
  });
  $("pm-duplicate").addEventListener("click", async () => {
    const p = getContextPage();
    closeAllPopovers();
    if (!p) return;
    const res = await api.duplicatePage(p.id);
    await loadWorkspacePages();
    await openPage(res.page.id);
    showToast("Page duplicated");
  });
  $("pm-add-subpage").addEventListener("click", async () => {
    const p = getContextPage();
    closeAllPopovers();
    if (!p) return;
    state.expandedPages.add(p.id);
    await createAndOpenPage(p.id);
  });
  $("pm-export-md").addEventListener("click", () => {
    closeAllPopovers();
    if (!state.currentPage) return;
    const md = editor.toMarkdown(state.currentPage.title || "Untitled");
    const safeName = (state.currentPage.title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".md";
    downloadTextFile(safeName, md, "text/markdown");
    showToast(`Exported ${safeName}`);
  });
  $("pm-full-width").addEventListener("click", async () => {
    const p = getContextPage();
    if (p) await togglePageField(p, "fullWidth");
    $("pm-full-width-indicator").classList.toggle("on", Boolean(p?.fullWidth));
  });
  $("pm-small-text").addEventListener("click", async () => {
    const p = getContextPage();
    if (p) await togglePageField(p, "smallText");
    $("pm-small-text-indicator").classList.toggle("on", Boolean(p?.smallText));
  });
  $("pm-lock-page").addEventListener("click", async () => {
    const p = getContextPage();
    if (p) await togglePageField(p, "isLocked");
    $("pm-lock-indicator").classList.toggle("on", Boolean(p?.isLocked));
  });
  $("pm-delete").addEventListener("click", async () => {
    const p = getContextPage();
    closeAllPopovers();
    if (p) await movePageToTrash(p);
  });

  // Search modal
  $("search-close-btn").addEventListener("click", closeSearchModal);
  $("search-modal").addEventListener("click", (e) => {
    if (e.target === $("search-modal")) closeSearchModal();
  });
  $("sf-title-only").addEventListener("click", () => {
    state.searchTitleOnly = !state.searchTitleOnly;
    $("sf-title-only").classList.toggle("active", state.searchTitleOnly);
    runSearch($("search-input").value);
  });
  $("sf-favorites-only").addEventListener("click", () => {
    state.searchFavoritesOnly = !state.searchFavoritesOnly;
    $("sf-favorites-only").classList.toggle("active", state.searchFavoritesOnly);
    runSearch($("search-input").value);
  });
  $("search-input").addEventListener("input", (e) => runSearch(e.target.value));
  $("search-input").addEventListener("keydown", async (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.searchSelectedIdx = (state.searchSelectedIdx + 1) % Math.max(1, state.searchResults.length);
      renderSearchResults();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.searchSelectedIdx = (state.searchSelectedIdx - 1 + state.searchResults.length) % Math.max(1, state.searchResults.length);
      renderSearchResults();
    } else if (e.key === "Enter" && state.searchResults[state.searchSelectedIdx]) {
      e.preventDefault();
      const target = state.searchResults[state.searchSelectedIdx];
      closeSearchModal();
      await openPage(target.id, false, { openInNewTab: e.metaKey || e.ctrlKey, pushHistory: true });
    } else if (e.key === "Escape") {
      closeSearchModal();
    }
  });

  // Settings modal
  $("settings-close-btn").addEventListener("click", () => $("settings-modal").classList.add("hidden"));
  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) $("settings-modal").classList.add("hidden");
  });
  document.querySelectorAll(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchSettingsTab(tab.dataset.tab));
  });

  $("save-profile-btn").addEventListener("click", async () => {
    const fb = $("profile-feedback");
    fb.classList.remove("hidden", "error");
    try {
      const res = await api.updateProfile({
        name: $("settings-name-input").value.trim(),
        email: $("settings-email-input").value.trim(),
      });
      state.user = res.user;
      renderUserUI();
      fb.textContent = "Profile updated.";
    } catch (err) {
      fb.textContent = err.message;
      fb.classList.add("error");
    }
  });

  $("change-password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fb = $("password-feedback");
    fb.classList.remove("hidden", "error");
    try {
      await api.changePassword({
        currentPassword: $("current-password-input").value,
        newPassword: $("new-password-input").value,
      });
      $("current-password-input").value = "";
      $("new-password-input").value = "";
      fb.textContent = "Password changed successfully.";
    } catch (err) {
      fb.textContent = err.message;
      fb.classList.add("error");
    }
  });

  $("theme-select").addEventListener("change", async (e) => {
    const theme = e.target.value;
    applyTheme(theme);
    try {
      const res = await api.updateProfile({ theme });
      state.user = res.user;
    } catch {}
  });

  $("save-workspace-btn").addEventListener("click", async () => {
    const ws = getCurrentWorkspace();
    if (!ws) return;
    const fb = $("workspace-feedback");
    fb.classList.remove("hidden", "error");
    try {
      const res = await api.updateWorkspace(ws.id, {
        name: $("settings-ws-name").value.trim(),
        icon: $("settings-ws-icon").value.trim(),
      });
      Object.assign(ws, res.workspace);
      renderWorkspaceHeader();
      fb.textContent = "Workspace updated.";
    } catch (err) {
      fb.textContent = err.message;
      fb.classList.add("error");
    }
  });

  $("delete-workspace-btn").addEventListener("click", async () => {
    const ws = getCurrentWorkspace();
    if (!ws) return;
    const fb = $("workspace-feedback");
    fb.classList.remove("hidden", "error");
    if (state.workspaces.length <= 1) {
      fb.textContent = "You cannot delete your only workspace. Create another workspace first.";
      fb.classList.add("error");
      return;
    }
    const confirmed = confirm(`Permanently delete workspace "${ws.name}" and all pages inside it? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api.deleteWorkspace(ws.id);
      state.workspaces = state.workspaces.filter((w) => w.id !== ws.id);
      state.currentWorkspaceId = state.workspaces[0]?.id || null;
      state.tabs = [];
      state.activeTabId = null;
      $("settings-modal").classList.add("hidden");
      renderWorkspaceHeader();
      await loadWorkspacePages();
      const first = state.pages[0];
      if (first) await openPage(first.id, false, { openInNewTab: true, pushHistory: false });
      else setMainView("empty");
      showToast(`Deleted workspace "${ws.name}"`);
    } catch (err) {
      fb.textContent = err.message;
      fb.classList.add("error");
    }
  });

  $("export-ws-json-btn").addEventListener("click", async () => {
    if (!state.currentWorkspaceId) return;
    try {
      const data = await api.exportWorkspace(state.currentWorkspaceId);
      downloadTextFile("notion-workspace-backup.json", JSON.stringify(data, null, 2), "application/json");
      showToast("Workspace JSON backup downloaded");
    } catch (err) {
      showToast(err.message);
    }
  });

  $("settings-logout-btn").addEventListener("click", doLogout);
  $("settings-logout-all-btn").addEventListener("click", async () => {
    await api.logoutAll();
    $("settings-modal").classList.add("hidden");
    state.user = null;
    state.tabs = [];
    state.authMode = "login";
    renderAuthView();
    showToast("Logged out of all devices");
  });

  // Shortcuts
  window.addEventListener("keydown", (e) => {
    if (!state.user) return;
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "p")) {
      e.preventDefault();
      if ($("search-modal").classList.contains("hidden")) openSearchModal();
      else closeSearchModal();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
      e.preventDefault();
      toggleSidebar();
    } else if (e.key === "Escape") {
      closeAllPopovers();
      closeSearchModal();
      $("settings-modal").classList.add("hidden");
    }
  });

  document.addEventListener("click", (e) => {
    ["workspace-popover", "trash-popover", "page-menu-popover", "emoji-popover", "cover-popover", "share-popover"].forEach((id) => {
      const el = $(id);
      if (!el.classList.contains("hidden") && !el.contains(e.target)) el.classList.add("hidden");
    });
  });
}

async function doLogout() {
  closeAllPopovers();
  $("settings-modal").classList.add("hidden");
  await api.logout();
  state.user = null;
  state.tabs = [];
  state.activeTabId = null;
  state.authMode = "login";
  renderAuthView();
}

// ============ INIT ============
async function init() {
  hydrateIcons();

  editor = new BlockEditor({
    container: $("blocks-container"),
    slashMenu: $("slash-menu"),
    slashList: $("slash-menu-list"),
    wikiMenu: $("wiki-menu"),
    wikiList: $("wiki-menu-list"),
    blockMenu: $("block-menu"),
    formatToolbar: $("format-toolbar"),
    getPages: () => state.pages,
    onNavigateWikiLink: (title) => navigateWikiLink(title),
    onChange: (blocks) => {
      state.currentBlocks = blocks;
      scheduleSaveBlocks(blocks);
    },
    onCreateSubpage: async () => {
      if (state.currentPage) {
        state.expandedPages.add(state.currentPage.id);
        await createAndOpenPage(state.currentPage.id);
      }
    },
  });

  graphView = new GraphView({
    canvas: $("graph-canvas"),
    statsEl: $("graph-stats"),
    onOpenPage: (pageId) => openPage(pageId),
  });

  bindEvents();

  try {
    const res = await api.me();
    if (res.user) {
      state.user = res.user;
      state.workspaces = res.workspaces || [];
      state.currentWorkspaceId = state.workspaces[0]?.id || null;
      await enterApp();
    } else {
      state.authMode = "register";
      renderAuthView();
    }
  } catch {
    state.authMode = "register";
    renderAuthView();
  }
}

init();
