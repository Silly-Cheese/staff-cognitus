export function clean(value) {
  return String(value ?? "").trim();
}

export function lower(value) {
  return clean(value).toLowerCase();
}

export function normalizeDiscordId(value) {
  const id = clean(value).replace(/\D/g, "");
  return /^\d{15,25}$/.test(id) ? id : "";
}

export function authEmail(discordId) {
  const id = normalizeDiscordId(discordId);
  return id ? `${id}@cognitus.local` : "";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function safe(value) {
  return escapeHtml(value);
}

export function route() {
  return location.hash.replace(/^#/, "").split("?")[0] || "/dashboard";
}

export function routeSegments() {
  return route().split("/").filter(Boolean);
}

export function params() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}

export function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function formatTimestamp(value, fallback = "—") {
  try {
    const date = value?.toDate?.() || (value ? new Date(value) : null);
    if (!date || Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return fallback;
  }
}

export function formatDate(value, fallback = "—") {
  try {
    const date = value?.toDate?.() || (value ? new Date(value) : null);
    if (!date || Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return fallback;
  }
}

export function newestFirst(items = [], field = "createdAt") {
  const time = (value) => {
    try {
      return value?.toDate?.()?.getTime?.() || new Date(value || 0).getTime() || 0;
    } catch {
      return 0;
    }
  };
  return [...items].sort((a, b) => time(b?.[field]) - time(a?.[field]));
}

export function alphabetic(items = [], field = "displayName") {
  return [...items].sort((a, b) => clean(a?.[field]).localeCompare(clean(b?.[field]), undefined, { sensitivity: "base" }));
}

export function initials(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return "CS";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
}

export function createEmployeeId() {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  const digits = Array.from(bytes, (value) => String(value % 10)).join("");
  const suffix = String(Date.now()).slice(-2);
  return `COG-${digits}${suffix}`;
}

export function createCognitusId(prefix) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(7);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
  return `${prefix}-${String(new Date().getFullYear()).slice(-2)}-${random}`;
}

export function setBusy(button, busy, busyText = "Working…", normalText = "Continue") {
  if (!button) return;
  if (!button.dataset.normalText) button.dataset.normalText = normalText || button.textContent;
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");
  button.textContent = busy ? busyText : button.dataset.normalText;
}

export function showNotice(element, message, tone = "neutral") {
  if (!element) return;
  element.hidden = false;
  element.className = `notice notice-${tone}`;
  element.textContent = message;
}

export function titleCase(value) {
  return clean(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function statusLabel(status) {
  const labels = {
    active: "Active",
    training: "Training",
    on_leave: "On Leave",
    suspended: "Suspended",
    former: "Former",
    pending: "Pending"
  };
  return labels[status] || titleCase(status || "Unknown");
}

export function relativeGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function debounce(fn, delay = 120) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
