const ACTIVE = new Set(["active", "training", "on_leave"]);
const ADMIN_PERMS = new Set(["staff.manage", "staff.private.read", "hr.records.read", "hr.records.manage", "permissions.manage", "system.manage", "audit.read"]);

function clean(v) { return String(v ?? "").trim(); }
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
function uniqueIds(list = []) {
  return [...new Set(list.map(v => clean(v).replace(/\D/g, "")).filter(v => /^\d{10,25}$/.test(v)))];
}
function parseIds(v) {
  try { return uniqueIds(JSON.parse(v || "[]")); } catch { return []; }
}
function decodeValue(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}
function uidFromJwt(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = part.padEnd(Math.ceil(part.length / 4) * 4, "=");
    const body = JSON.parse(atob(padded));
    return clean(body.user_id || body.sub);
  } catch { return ""; }
}
function effectivePerms(access) {
  const direct = Array.isArray(access?.permissions) ? access.permissions : [];
  const discord = Array.isArray(access?.discordRoleSync?.managedPermissions) ? access.discordRoleSync.managedPermissions : [];
  const denied = new Set(Array.isArray(access?.deniedPermissions) ? access.deniedPermissions : []);
  return [...new Set([...direct, ...discord])].filter(p => !denied.has(p));
}
function cors(request, env) {
  const origin = request.headers.get("origin");
  const allowed = clean(env.ALLOWED_ORIGINS).split(",").map(v => v.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "vary": "Origin"
  };
}
function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors(request, env))) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function firestoreGet(env, token, path) {
  const project = clean(env.FIREBASE_PROJECT_ID || "cognitus-solutions");
  const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(project) + "/databases/(default)/documents/" + path;
  const response = await fetch(url, { headers: { authorization: "Bearer " + token, accept: "application/json" } });
  if (!response.ok) throw Object.assign(new Error(response.status === 404 ? "Cognitus record not found." : "Cognitus authorization failed."), { status: response.status === 404 ? 404 : 401 });
  const body = await response.json();
  return decodeFields(body.fields || {});
}
async function authenticate(request, env) {
  const match = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Sign in to Cognitus Staff first."), { status: 401 });
  const token = match[1];
  const uid = uidFromJwt(token);
  if (!uid) throw Object.assign(new Error("Invalid Cognitus session."), { status: 401 });
  const user = await firestoreGet(env, token, "users/" + encodeURIComponent(uid));
  const access = await firestoreGet(env, token, "staffAccess/" + encodeURIComponent(uid)).catch(e => e.status === 404 ? null : Promise.reject(e));
  const permissions = effectivePerms(access);
  const owner = user?.status === "active" && user?.role === "owner";
  const active = Boolean(access && ACTIVE.has(access.status) && permissions.includes("portal.access"));
  if (!owner && !active) throw Object.assign(new Error("Active staff access required."), { status: 403 });
  return {
    uid, token, user, access, permissions,
    admin: Boolean(owner || access?.rank === "co-owner" || permissions.some(p => ADMIN_PERMS.has(p)))
  };
}
function dateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return map.year + "-" + map.month + "-" + map.day;
}
function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diffDays(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
async function getSettings(env) {
  return env.DB.prepare("SELECT * FROM quota_settings WHERE id=1").first();
}
function periodBounds(settings, today) {
  if (settings.period_type === "monthly") {
    const start = today.slice(0, 7) + "-01";
    const [y, m] = start.split("-").map(Number);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { id: "monthly_" + start, start, end };
  }
  const length = settings.period_type === "biweekly" ? 14 : 7;
  const anchor = settings.anchor_date || "2026-01-05";
  const offset = Math.floor(diffDays(anchor, today) / length) * length;
  const start = addDays(anchor, offset);
  return { id: settings.period_type + "_" + start, start, end: addDays(start, length - 1) };
}
async function currentPeriod(env) {
  const settings = await getSettings(env);
  const today = dateInZone(new Date(), settings.timezone || "America/Chicago");
  const p = periodBounds(settings, today);
  await env.DB.prepare("INSERT OR IGNORE INTO quota_periods(id,starts_on,ends_on,required_messages) VALUES(?,?,?,?)")
    .bind(p.id, p.start, p.end, Number(settings.default_required_messages || 100)).run();
  return { ...p, today, required: Number(settings.default_required_messages || 100), settings };
}
async function upsertSelf(env, auth) {
  const discordRaw = clean(auth.user?.discordOauthId || auth.user?.discordId).replace(/\D/g, "");
  const discordId = /^\d{10,25}$/.test(discordRaw) ? discordRaw : null;
  await env.DB.prepare(
    "INSERT INTO quota_roster(firebase_uid,discord_user_id,display_name,employee_id,department_id,rank,status,last_synced_at) VALUES(?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(firebase_uid) DO UPDATE SET discord_user_id=COALESCE(excluded.discord_user_id,quota_roster.discord_user_id),display_name=excluded.display_name," +
    "employee_id=COALESCE(excluded.employee_id,quota_roster.employee_id),department_id=COALESCE(excluded.department_id,quota_roster.department_id)," +
    "rank=COALESCE(excluded.rank,quota_roster.rank),status=excluded.status,last_synced_at=excluded.last_synced_at"
  ).bind(
    auth.uid, discordId, auth.user?.displayName || auth.user?.discordUsername || "Cognitus Staff",
    auth.access?.employeeId || null, auth.access?.departmentId || null, auth.access?.rank || null,
    auth.access?.status || "active", new Date().toISOString()
  ).run();
  return env.DB.prepare("SELECT * FROM quota_roster WHERE firebase_uid=?").bind(auth.uid).first();
}
async function progress(env, row, period) {
  const activity = row.discord_user_id
    ? await env.DB.prepare("SELECT COALESCE(SUM(message_count),0) total,MAX(last_message_at) last_at FROM message_activity WHERE discord_user_id=? AND activity_date>=? AND activity_date<=?")
        .bind(row.discord_user_id, period.start, period.end).first()
    : { total: 0, last_at: null };
  const adjustment = await env.DB.prepare("SELECT COALESCE(SUM(amount),0) total FROM quota_adjustments WHERE firebase_uid=? AND period_id=?")
    .bind(row.firebase_uid, period.id).first();
  const exemption = await env.DB.prepare("SELECT reason FROM quota_exemptions WHERE firebase_uid=? AND starts_on<=? AND ends_on>=? ORDER BY created_at DESC LIMIT 1")
    .bind(row.firebase_uid, period.end, period.start).first();
  const required = Number(row.custom_required_messages ?? period.required);
  const total = Math.max(0, Number(activity?.total || 0) + Number(adjustment?.total || 0));
  const exempt = row.status === "on_leave" || Boolean(exemption);
  const remaining = exempt ? 0 : Math.max(0, required - total);
  const daysRemaining = Math.max(0, diffDays(period.today, period.end) + 1);
  const status = ["former","suspended"].includes(row.status) ? "not_applicable"
    : exempt ? "exempt"
    : total >= required ? "met"
    : total === 0 ? "no_activity"
    : daysRemaining <= 2 ? "at_risk"
    : "in_progress";
  return {
    firebaseUid: row.firebase_uid,
    discordUserId: row.discord_user_id,
    displayName: row.display_name,
    employeeId: row.employee_id,
    departmentId: row.department_id,
    rank: row.rank,
    staffStatus: row.status,
    customRequiredMessages: row.custom_required_messages,
    messages: Number(activity?.total || 0),
    adjustment: Number(adjustment?.total || 0),
    total, required, remaining,
    percentage: required ? Math.round((total / required) * 1000) / 10 : 100,
    status, exempt,
    exemptionReason: row.status === "on_leave" ? "Approved leave" : (exemption?.reason || null),
    daysRemaining,
    averageNeededPerDay: remaining && daysRemaining ? Math.ceil(remaining / daysRemaining) : 0,
    lastActivityAt: activity?.last_at || null,
    linked: Boolean(row.discord_user_id)
  };
}
async function selfPayload(env, auth) {
  const row = await upsertSelf(env, auth);
  const period = await currentPeriod(env);
  const p = await progress(env, row, period);
  const daily = row.discord_user_id
    ? (await env.DB.prepare("SELECT activity_date date,SUM(message_count) messages FROM message_activity WHERE discord_user_id=? AND activity_date>=? AND activity_date<=? GROUP BY activity_date ORDER BY activity_date")
        .bind(row.discord_user_id, period.start, period.end).all()).results || []
    : [];
  return { period: { id: period.id, startsOn: period.start, endsOn: period.end }, progress: p, daily };
}
async function adminPayload(env) {
  const period = await currentPeriod(env);
  const rows = (await env.DB.prepare("SELECT * FROM quota_roster ORDER BY display_name COLLATE NOCASE").all()).results || [];
  const staff = [];
  for (const row of rows) staff.push(await progress(env, row, period));
  const current = staff.filter(x => !["former","suspended"].includes(x.staffStatus));
  return {
    period: { id: period.id, startsOn: period.start, endsOn: period.end },
    summary: {
      total: current.length,
      met: current.filter(x => x.status === "met").length,
      atRisk: current.filter(x => ["at_risk","no_activity"].includes(x.status)).length,
      exempt: current.filter(x => x.status === "exempt").length,
      linked: current.filter(x => x.linked).length
    },
    staff
  };
}
async function audit(env, actor, action, target = null, detail = {}) {
  await env.DB.prepare("INSERT INTO quota_audit(id,actor_uid,action,target_uid,detail_json,created_at) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actor, action, target, JSON.stringify(detail), new Date().toISOString()).run();
}
async function handleApi(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (url.pathname === "/health") return json({ ok: true, service: "cognitus-quota" });
  const auth = await authenticate(request, env);
  if (url.pathname === "/api/me" && request.method === "GET") return json(await selfPayload(env, auth));
  if (!url.pathname.startsWith("/api/admin/")) return json({ error: "Not found." }, 404);
  if (!auth.admin) return json({ error: "Quota Administration access required." }, 403);

  if (url.pathname === "/api/admin/staff" && request.method === "GET") return json(await adminPayload(env));
  if (url.pathname === "/api/admin/settings" && request.method === "GET") {
    const s = await getSettings(env);
    return json({ defaultRequiredMessages: Number(s.default_required_messages), periodType: s.period_type, anchorDate: s.anchor_date, timezone: s.timezone, staffRoleIds: parseIds(s.staff_role_ids_json), includedChannelIds: parseIds(s.included_channel_ids_json), excludedChannelIds: parseIds(s.excluded_channel_ids_json) });
  }
  if (url.pathname === "/api/admin/settings" && request.method === "PUT") {
    const body = await request.json();
    const required = Number(body.defaultRequiredMessages);
    const type = clean(body.periodType);
    const anchor = clean(body.anchorDate);
    if (!Number.isInteger(required) || required < 1 || required > 100000) return json({ error: "Quota must be 1-100000." }, 400);
    if (!["weekly","biweekly","monthly"].includes(type)) return json({ error: "Invalid period type." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return json({ error: "Invalid anchor date." }, 400);
    const staffRoleIds = uniqueIds(body.staffRoleIds || []);\n    const includedChannelIds = uniqueIds(body.includedChannelIds || []);\n    const excludedChannelIds = uniqueIds(body.excludedChannelIds || []);\n    if (!staffRoleIds.length) return json({ error: "At least one staff Discord role ID is required." }, 400);\n    await env.DB.prepare("UPDATE quota_settings SET default_required_messages=?,period_type=?,anchor_date=?,staff_role_ids_json=?,included_channel_ids_json=?,excluded_channel_ids_json=?,updated_at=?,updated_by_uid=? WHERE id=1")\n      .bind(required, type, anchor, JSON.stringify(staffRoleIds), JSON.stringify(includedChannelIds), JSON.stringify(excludedChannelIds), new Date().toISOString(), auth.uid).run();\n    await audit(env, auth.uid, "settings.update", null, { required, type, anchor, staffRoleIds, includedChannelIds, excludedChannelIds });
    return json({ ok: true });
  }
  if (url.pathname === "/api/admin/roster-sync" && request.method === "POST") {
    const body = await request.json();
    const rows = Array.isArray(body.staff) ? body.staff.slice(0, 750) : [];
    for (const row of rows) {
      const uid = clean(row.firebaseUid);
      if (!uid) continue;
      const d = clean(row.discordUserId).replace(/\D/g, "");
      await env.DB.prepare(
        "INSERT INTO quota_roster(firebase_uid,discord_user_id,display_name,employee_id,department_id,rank,status,last_synced_at) VALUES(?,?,?,?,?,?,?,?) " +
        "ON CONFLICT(firebase_uid) DO UPDATE SET discord_user_id=COALESCE(excluded.discord_user_id,quota_roster.discord_user_id),display_name=excluded.display_name," +
        "employee_id=excluded.employee_id,department_id=excluded.department_id,rank=excluded.rank,status=excluded.status,last_synced_at=excluded.last_synced_at"
      ).bind(uid, /^\d{10,25}$/.test(d) ? d : null, clean(row.displayName) || "Cognitus Staff", clean(row.employeeId) || null,
        clean(row.departmentId) || null, clean(row.rank) || null, clean(row.status) || "active", new Date().toISOString()).run();
    }
    await audit(env, auth.uid, "roster.sync", null, { count: rows.length });
    return json({ ok: true, count: rows.length });
  }
  if (url.pathname === "/api/admin/target" && request.method === "POST") {
    const body = await request.json();
    const uid = clean(body.firebaseUid);
    const required = body.requiredMessages === "" || body.requiredMessages == null ? null : Number(body.requiredMessages);
    if (!uid || (required !== null && (!Number.isInteger(required) || required < 1 || required > 100000))) return json({ error: "Invalid target." }, 400);
    await env.DB.prepare("UPDATE quota_roster SET custom_required_messages=? WHERE firebase_uid=?").bind(required, uid).run();
    await audit(env, auth.uid, "target.update", uid, { required });
    return json({ ok: true });
  }
  if (url.pathname === "/api/admin/exemption" && request.method === "POST") {
    const body = await request.json();
    const uid = clean(body.firebaseUid), starts = clean(body.startsOn), ends = clean(body.endsOn), reason = clean(body.reason).slice(0, 500);
    if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}$/.test(ends) || ends < starts || reason.length < 5) return json({ error: "Invalid exemption." }, 400);
    await env.DB.prepare("INSERT INTO quota_exemptions(id,firebase_uid,starts_on,ends_on,reason,created_by_uid,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), uid, starts, ends, reason, auth.uid, new Date().toISOString()).run();
    await audit(env, auth.uid, "exemption.create", uid, { starts, ends, reason });
    return json({ ok: true });
  }
  if (url.pathname === "/api/admin/adjustment" && request.method === "POST") {
    const body = await request.json();
    const uid = clean(body.firebaseUid), amount = Number(body.amount), reason = clean(body.reason).slice(0, 500);
    const period = await currentPeriod(env);
    if (!uid || !Number.isInteger(amount) || amount === 0 || reason.length < 5) return json({ error: "Invalid adjustment." }, 400);
    await env.DB.prepare("INSERT INTO quota_adjustments(id,firebase_uid,period_id,amount,reason,created_by_uid,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), uid, period.id, amount, reason, auth.uid, new Date().toISOString()).run();
    await audit(env, auth.uid, "adjustment.create", uid, { amount, reason, periodId: period.id });
    return json({ ok: true });
  }
  if (url.pathname === "/api/admin/audit" && request.method === "GET") {
    const rows = (await env.DB.prepare("SELECT * FROM quota_audit ORDER BY created_at DESC LIMIT 75").all()).results || [];
    return json({ items: rows.map(r => ({ ...r, detail: (() => { try { return JSON.parse(r.detail_json); } catch { return {}; } })() })) });
  }
  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    try { return withCors(await handleApi(request, env), request, env); }
    catch (error) { return withCors(json({ error: error?.message || "Quota request failed." }, error?.status || 500), request, env); }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const gateway = env.QUOTA_GATEWAY.get(env.QUOTA_GATEWAY.idFromName("primary"));
      await gateway.fetch("https://internal/connect", { method: "POST" }).catch(() => {});
      const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      await env.DB.prepare("DELETE FROM quota_dedupe WHERE seen_at<?").bind(cutoff).run();
      await currentPeriod(env);
    })());
  }
};

export class DiscordQuotaGateway {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ws = null;
    this.seq = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.heartbeat = null;
    this.awaitingAck = false;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/status") return json({ connected: this.ws?.readyState === WebSocket.OPEN });
    if (path === "/connect") {
      await this.connect();
      return json({ ok: true });
    }
    return json({ error: "Not found." }, 404);
  }
  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    const settings = await getSettings(this.env);
    const roles = parseIds(settings.staff_role_ids_json);
    if (!clean(this.env.DISCORD_BOT_TOKEN) || !/^\d{10,25}$/.test(clean(this.env.DISCORD_GUILD_ID)) || !roles.length) return;
    const url = this.resumeUrl ? this.resumeUrl.replace(/\/$/, "") + "/?v=10&encoding=json" : "wss://gateway.discord.gg/?v=10&encoding=json";
    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", e => this.ctx.waitUntil(this.message(e.data)));
    this.ws.addEventListener("close", () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.ws = null;
      this.ctx.storage.setAlarm(Date.now() + 15000);
    });
  }
  async alarm() { await this.connect(); }
  send(data) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data)); }
  async message(raw) {
    let packet;
    try { packet = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch { return; }
    if (packet.s != null) this.seq = packet.s;
    if (packet.op === 10) {
      if (this.heartbeat) clearInterval(this.heartbeat);
      const every = Math.max(1000, Number(packet.d?.heartbeat_interval || 45000));
      this.heartbeat = setInterval(() => {
        if (this.awaitingAck) { try { this.ws?.close(4000, "heartbeat missed"); } catch {} return; }
        this.awaitingAck = true;
        this.send({ op: 1, d: this.seq });
      }, every);
      if (this.sessionId && this.resumeUrl && this.seq != null) {
        this.send({ op: 6, d: { token: this.env.DISCORD_BOT_TOKEN, session_id: this.sessionId, seq: this.seq } });
      } else {
        this.send({ op: 2, d: { token: this.env.DISCORD_BOT_TOKEN, intents: 513, properties: { os: "cloudflare", browser: "cognitus-quota", device: "cognitus-quota" } } });
      }
      return;
    }
    if (packet.op === 11) { this.awaitingAck = false; return; }
    if (packet.op === 7 || packet.op === 9) { try { this.ws?.close(4000, "reconnect"); } catch {} return; }
    if (packet.op !== 0) return;
    if (packet.t === "READY") {
      this.sessionId = packet.d?.session_id || null;
      this.resumeUrl = packet.d?.resume_gateway_url || null;
      return;
    }
    if (packet.t !== "MESSAGE_CREATE") return;

    const m = packet.d || {};
    if (clean(m.guild_id) !== clean(this.env.DISCORD_GUILD_ID) || m.author?.bot || m.webhook_id) return;
    const settings = await getSettings(this.env);
    const roles = parseIds(settings.staff_role_ids_json);
    const memberRoles = uniqueIds(m.member?.roles || []);
    if (!roles.some(id => memberRoles.includes(id))) return;

    const included = parseIds(settings.included_channel_ids_json);
    const excluded = parseIds(settings.excluded_channel_ids_json);
    const channelId = clean(m.channel_id).replace(/\D/g, "");
    if (included.length && !included.includes(channelId)) return;
    if (excluded.includes(channelId)) return;

    const messageId = clean(m.id).replace(/\D/g, "");
    const discordUserId = clean(m.author?.id).replace(/\D/g, "");
    if (!/^\d{10,25}$/.test(messageId) || !/^\d{10,25}$/.test(discordUserId) || !/^\d{10,25}$/.test(channelId)) return;

    const dedupe = await this.env.DB.prepare("INSERT OR IGNORE INTO quota_dedupe(message_id,seen_at) VALUES(?,?)")
      .bind(messageId, new Date().toISOString()).run();
    if (!dedupe.meta?.changes) return;

    const when = m.timestamp ? new Date(m.timestamp) : new Date();
    const date = dateInZone(Number.isNaN(when.getTime()) ? new Date() : when, settings.timezone || "America/Chicago");
    await this.env.DB.prepare(
      "INSERT INTO message_activity(guild_id,discord_user_id,activity_date,channel_id,message_count,last_message_at) VALUES(?,?,?,?,1,?) " +
      "ON CONFLICT(guild_id,discord_user_id,activity_date,channel_id) DO UPDATE SET message_count=message_count+1,last_message_at=excluded.last_message_at"
    ).bind(clean(this.env.DISCORD_GUILD_ID), discordUserId, date, channelId, new Date().toISOString()).run();
  }
}
