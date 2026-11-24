async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  // Auth
  me: () => request("/api/auth/me"),
  register: (payload) => request("/api/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/api/auth/login", { method: "POST", body: payload }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  logoutAll: () => request("/api/auth/logout-all", { method: "POST" }),
  updateProfile: (payload) => request("/api/auth/profile", { method: "PATCH", body: payload }),
  changePassword: (payload) => request("/api/auth/password", { method: "POST", body: payload }),

  // Storage stats
  storageStats: () => request("/api/storage/stats"),

  // Workspaces
  listWorkspaces: () => request("/api/workspaces"),
  createWorkspace: (payload) => request("/api/workspaces", { method: "POST", body: payload }),
  updateWorkspace: (wsId, payload) => request(`/api/workspaces/${wsId}`, { method: "PATCH", body: payload }),
  deleteWorkspace: (wsId) => request(`/api/workspaces/${wsId}`, { method: "DELETE" }),
  exportWorkspace: (wsId) => request(`/api/workspaces/${wsId}/export`),
  getHome: (wsId) => request(`/api/workspaces/${wsId}/home`),
  getGraph: (wsId) => request(`/api/workspaces/${wsId}/graph`),

  // Pages
  listPages: (wsId, trashed = false) =>
    request(`/api/workspaces/${wsId}/pages${trashed ? "?trashed=1" : ""}`),
  createPage: (wsId, payload = {}) =>
    request(`/api/workspaces/${wsId}/pages`, { method: "POST", body: payload }),
  getPage: (pageId) => request(`/api/pages/${pageId}`),
  updatePage: (pageId, payload) =>
    request(`/api/pages/${pageId}`, { method: "PATCH", body: payload }),
  duplicatePage: (pageId) =>
    request(`/api/pages/${pageId}/duplicate`, { method: "POST" }),
  deletePagePermanently: (pageId) =>
    request(`/api/pages/${pageId}`, { method: "DELETE" }),
  saveBlocks: (pageId, blocks) =>
    request(`/api/pages/${pageId}/blocks`, { method: "PUT", body: { blocks } }),

  // Comments
  addComment: (pageId, content) =>
    request(`/api/pages/${pageId}/comments`, { method: "POST", body: { content } }),
  deleteComment: (commentId) =>
    request(`/api/comments/${commentId}`, { method: "DELETE" }),

  // Search
  search: (wsId, q, { titleOnly = false, favoritesOnly = false } = {}) =>
    request(
      `/api/workspaces/${wsId}/search?q=${encodeURIComponent(q || "")}&titleOnly=${titleOnly ? 1 : 0}&favoritesOnly=${favoritesOnly ? 1 : 0}`
    ),
};
