/**
 * dsh-anime-theme — 宿主半体 (host half)
 *
 * 职责：
 *   1. 配置持久化：~/.dsh/anime-theme/config.json
 *   2. 图片源代理：绕过浏览器 CORS —— api.cnmiw.com 不返回 Access-Control-Allow-Origin
 *   3. 图片中继：为需要 Referer 的直连链路 (sinaimg.cn) 补齐请求头，顺带解决防盗链
 *
 * 所有路由挂在 prefix "/dsh-anime-theme" 下，无 webServer 服务时自动降级
 * （客户端半体会退回直连 API 模式），因此本插件在 Web 与桌面端均可加载。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

export const name = "dsh-anime-theme";

/** 与 package.json 保持一致的版本号（健康检查用）。 */
const PLUGIN_VERSION = "1.4.0";

/** 无必需服务：webServer 走可选用注入，缺失时不阻塞插件加载。 */
export const inject = [];

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const ROUTE_PREFIX = "/dsh-anime-theme";
const UPSTREAM = "https://api.cnmiw.com/api.php";
const FETCH_TIMEOUT_MS = 15000;
const IMAGE_TIMEOUT_MS = 30000;
const MAX_NUM = 100;
const MAX_BODY_BYTES = 64 * 1024;
const UA = "DSH-Anime-Theme/1.0 (+https://github.com/)";
const WEIBO_REFERER = "https://weibo.com/";

/** 图片中继白名单：只放行图片源域名后缀，避免变成任意 URL 代理 (SSRF)。 */
const ALLOWED_IMAGE_SUFFIXES = [
  "iw233.top",
  "sinaimg.cn",
  "cnmiw.com",
  "weibo.com",
  "hdslb.com",
  "pixiv.re",
  "pximg.net",
  "catbox.moe",
  "sakurakoi.top",
];

/** 可选 sort 值：CDN 链路免 Referer 更稳，直连链路需要 Referer。 */
const SORT_NSFW = "CDNsetu";
const SORT_SFW = "CDNcat";

/**
 * 上游的「全站随机」池 —— 会混进色图。
 *
 * MirlKoi 的分类页把 iw233 / top / pc / mp 归在「无色图」下，
 * 但 random 是区块级的「全站随机」，跨了无色图与色图两个池。
 * 无色图模式下如果配置里残留了 random，就会出现「选了无色图却蹦出色图」，
 * 所以这里直接降级到 SORT_SFW 并如实上报，而不是照单全收。
 */
const MIXED_SORTS = new Set(["random", "cdnrandom"]);

/** 判断某个 sort 是否属于会混色的池子。 */
function isMixedSort(sort) {
  return MIXED_SORTS.has(String(sort || "").trim().toLowerCase());
}

/** 配置结构版本；展示层设置改语义时 +1。 */
const SCHEMA_VERSION = 2;

const DEFAULT_CONFIG = {
  enabled: true,
  allowNsfw: false,
  sortSfw: SORT_SFW,
  sortNsfw: SORT_NSFW,
  autoRefreshMinutes: 0,
  recentLimit: 50,
  recent: [],
  // 以下为展示层设置，同样由宿主持久化 —— 否则改完一刷新就回到默认值
  dim: 0.3,
  fillBlur: 40,
  fit: "smart",
  veil: "auto",
  darkBoost: true,
  coverFocus: 25,
  isolatePanels: false,
  dockX: 18,
  dockY: 76,
  schemaVersion: SCHEMA_VERSION,
};

/**
 * 配置结构版本。展示层设置改语义时 +1。
 *
 * v1 → v2：blur 从「整层虚化 0~24」改成「留白铺底虚化 16~80」，并改名 fillBlur；
 * fit 的取值从 cover|contain 改成 smart|cover|plain。
 * 老配置里的 blur:0 / fit:"cover" 是按旧语义存下来的，直接沿用会让
 * 新自适应模式退化成「一张清晰的放大副本」，所以老版本整段丢弃、回到新默认值。
 */
const LEGACY_DISPLAY_KEYS = ["blur", "fit", "veil", "dim", "isolatePanels", "fillBlur"];

const CONFIG_DIR = join(homedir(), ".dsh", "anime-theme");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
/** 客户端自测量落盘位置（JSONL，每行一条），用于排查几何/包含块问题。 */
const DIAG_PATH = join(CONFIG_DIR, "diagnostics.jsonl");
const DIAG_MAX_BYTES = 512 * 1024;

// ---------------------------------------------------------------------------
// 配置读写
// ---------------------------------------------------------------------------

function readConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_CONFIG };
    }
    // 老结构版本：丢弃语义已变的展示层键，其余（开关/分类/去重）保留
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      for (const key of LEGACY_DISPLAY_KEYS) delete parsed[key];
      parsed.schemaVersion = SCHEMA_VERSION;
      console.warn(
        "[dsh-anime-theme] 配置结构升级到 v" + SCHEMA_VERSION + "，展示层设置已回到新默认值",
      );
      // 立刻落盘，免得每次读配置都重新迁移一遍
      writeConfig({ ...DEFAULT_CONFIG, ...parsed });
    }
    const merged = { ...DEFAULT_CONFIG, ...parsed };
    if (!Array.isArray(merged.recent)) merged.recent = [];
    return merged;
  } catch (err) {
    console.warn("[dsh-anime-theme] 读取配置失败，使用默认值：", err && err.message);
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config) {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    // 无 BOM 的 UTF-8：带 BOM 会让 Node 的 JSON.parse 直接抛 SyntaxError
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8" });
    return true;
  } catch (err) {
    console.warn("[dsh-anime-theme] 写入配置失败：", err && err.message);
    return false;
  }
}

/**
 * 追加一条客户端自测量。只接收几何量，做体积上限保护，超出就整体清空重来，
 * 避免无限增长。任何失败都静默，绝不影响主流程。
 */
function appendDiagnostic(payload) {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    try {
      if (existsSync(DIAG_PATH) && statSync(DIAG_PATH).size > DIAG_MAX_BYTES) {
        writeFileSync(DIAG_PATH, "", { encoding: "utf8" });
      }
    } catch { /* 检查失败就继续追加 */ }
    appendFileSync(DIAG_PATH, JSON.stringify(payload) + "\n", { encoding: "utf8" });
    return true;
  } catch (err) {
    console.warn("[dsh-anime-theme] 写诊断失败：", err && err.message);
    return false;
  }
}

/** 只接受已知键，并且做类型收敛，防止客户端把任意 JSON 塞进配置文件。 */
const BOOL_KEYS = ["enabled", "allowNsfw", "isolatePanels", "darkBoost"];
const STR_KEYS = ["sortSfw", "sortNsfw"];
/** 枚举键：只放行白名单取值。 */
const ENUM_KEYS = {
  fit: ["smart", "cover", "cover-top", "plain"],
  veil: ["auto", "dark", "light"],
};
/** 整数键：取值上下限。 */
const INT_KEYS = {
  autoRefreshMinutes: [0, 1440],
  fillBlur: [16, 80],
  coverFocus: [0, 100],
  dockX: [0, 8000],
  dockY: [0, 8000],
  recentLimit: [1, 500],
};
/** 小数键：取值上下限。 */
const FLOAT_KEYS = {
  dim: [0, 0.85],
};

function sanitizePatch(input) {
  const patch = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return patch;

  for (const key of BOOL_KEYS) {
    if (typeof input[key] === "boolean") patch[key] = input[key];
  }

  for (const key of STR_KEYS) {
    if (typeof input[key] === "string" && input[key].trim() !== "" && input[key].length <= 32) {
      patch[key] = input[key].trim();
    }
  }

  for (const [key, allowed] of Object.entries(ENUM_KEYS)) {
    if (typeof input[key] === "string" && allowed.includes(input[key])) patch[key] = input[key];
  }

  for (const [key, range] of Object.entries(INT_KEYS)) {
    const value = Number(input[key]);
    if (Number.isFinite(value) && value >= range[0] && value <= range[1]) {
      patch[key] = Math.round(value);
    }
  }

  for (const [key, range] of Object.entries(FLOAT_KEYS)) {
    const value = Number(input[key]);
    if (Number.isFinite(value) && value >= range[0] && value <= range[1]) {
      patch[key] = value;
    }
  }

  return patch;
}

// ---------------------------------------------------------------------------
// 上游调用
// ---------------------------------------------------------------------------

async function withTimeout(fn, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** 直取 cnmiw (MirlKoi) 随机图地址列表。 */
async function fetchRandomUrls(sort, num) {
  const url = UPSTREAM + "?sort=" + encodeURIComponent(sort) + "&type=json&num=" + num + "&_t=" + Date.now();
  const payload = await withTimeout(async (signal) => {
    const response = await fetch(url, {
      signal,
      headers: {
        "user-agent": UA,
        accept: "application/json, text/json, */*",
        referer: "https://api.cnmiw.com/",
      },
    });
    if (!response.ok) throw new Error("upstream HTTP " + response.status);
    const text = await response.text();
    const start = text.indexOf("{");
    if (start < 0) throw new Error("upstream returned non-JSON payload");
    return JSON.parse(text.slice(start));
  }, FETCH_TIMEOUT_MS);

  const pic = payload && payload.pic;
  const list = Array.isArray(pic) ? pic : pic ? [pic] : [];
  return list.filter((entry) => typeof entry === "string" && /^https?:\/\//i.test(entry));
}

function hostAllowed(target) {
  const lower = target.toLowerCase();
  return ALLOWED_IMAGE_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith("." + suffix),
  );
}

// ---------------------------------------------------------------------------
// HTTP 辅助
// ---------------------------------------------------------------------------

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

/** 去重：把新地址压入 recent 环形缓冲，并返回一个不在 recent 内的地址。 */
function pickFresh(urls, config) {
  const recent = Array.isArray(config.recent) ? config.recent : [];
  const fresh = urls.find((url) => !recent.includes(url));
  const chosen = fresh || urls[0];
  if (chosen) {
    recent.push(chosen);
    const limit = Math.max(1, Math.min(500, Number(config.recentLimit) || 50));
    while (recent.length > limit) recent.shift();
    config.recent = recent;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// 路由处理
// ---------------------------------------------------------------------------

async function handleRandom(query, response) {
  const config = readConfig();
  const wantsNsfw = query.get("nsfw") === "1";
  // 服务端二次把关：未开启色图时，无论客户端传什么都不会走色图分类
  const nsfwAllowed = config.allowNsfw === true;
  const useNsfw = wantsNsfw && nsfwAllowed;
  let sort = useNsfw ? config.sortNsfw || SORT_NSFW : config.sortSfw || SORT_SFW;

  // 无色图模式下不允许走「全站随机」池，降级并如实告知
  let downgraded = null;
  if (!useNsfw && isMixedSort(sort)) {
    downgraded = "分类 " + sort + " 是全站随机池（会混进色图），无色图模式下已自动降级为 " + SORT_SFW;
    console.warn("[dsh-anime-theme] " + downgraded);
    sort = SORT_SFW;
  }

  const requested = Number(query.get("num"));
  const num = Number.isFinite(requested) ? Math.max(1, Math.min(MAX_NUM, Math.floor(requested))) : 10;

  try {
    const urls = await fetchRandomUrls(sort, num);
    if (urls.length === 0) {
      sendJson(response, 502, { ok: false, error: "upstream returned no image url" });
      return;
    }
    const chosen = pickFresh(urls, config);
    writeConfig(config);
    sendJson(response, 200, {
      ok: true,
      mode: useNsfw ? "nsfw" : "sfw",
      sort,
      url: chosen,
      candidates: urls.length,
      via: "host",
      downgraded,
    });
  } catch (err) {
    sendJson(response, 502, { ok: false, error: String((err && err.message) || err) });
  }
}

async function handleImage(query, response) {
  const raw = query.get("u");
  if (!raw) {
    sendJson(response, 400, { ok: false, error: "missing ?u=" });
    return;
  }
  let target;
  try {
    target = new URL(raw);
  } catch {
    sendJson(response, 400, { ok: false, error: "invalid url" });
    return;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    sendJson(response, 400, { ok: false, error: "unsupported protocol" });
    return;
  }
  if (!hostAllowed(target.hostname)) {
    sendJson(response, 403, { ok: false, error: "host not in allowlist: " + target.hostname });
    return;
  }

  try {
    const upstream = await withTimeout(
      (signal) =>
        fetch(target.href, {
          signal,
          redirect: "follow",
          headers: {
            "user-agent": UA,
            accept: "image/avif,image/webp,image/*,*/*;q=0.8",
            // 直连链路 (sinaimg.cn) 强制校验 Referer，这里统一补上
            referer: WEIBO_REFERER,
          },
        }),
      IMAGE_TIMEOUT_MS,
    );

    if (!upstream.ok || !upstream.body) {
      sendJson(response, 502, { ok: false, error: "upstream HTTP " + upstream.status });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      sendJson(response, 502, { ok: false, error: "upstream content-type is not an image" });
      return;
    }

    const headers = {
      "content-type": contentType,
      "cache-control": "public, max-age=3600",
    };
    const length = upstream.headers.get("content-length");
    if (length) headers["content-length"] = length;

    response.writeHead(200, headers);
    Readable.fromWeb(upstream.body).pipe(response);
  } catch (err) {
    if (!response.headersSent) {
      sendJson(response, 502, { ok: false, error: String((err && err.message) || err) });
    } else {
      response.end();
    }
  }
}

function createHandler() {
  return async function handler(request, response) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const path = url.pathname.slice(ROUTE_PREFIX.length) || "/";

    try {
      if (path === "/api/health") {
        sendJson(response, 200, { ok: true, name, version: PLUGIN_VERSION });
        return;
      }

      if (path === "/api/config") {
        if (request.method === "GET") {
          sendJson(response, 200, { ok: true, config: readConfig() });
          return;
        }
        if (request.method === "POST") {
          const body = await readJsonBody(request);
          const config = readConfig();
          const next = { ...config, ...sanitizePatch(body) };
          const saved = writeConfig(next);
          sendJson(response, saved ? 200 : 500, { ok: saved, config: next });
          return;
        }
        sendJson(response, 405, { ok: false, error: "method not allowed" });
        return;
      }

      if (path === "/api/diag") {
        if (request.method !== "POST") {
          sendJson(response, 405, { ok: false, error: "method not allowed" });
          return;
        }
        const body = await readJsonBody(request);
        const saved = appendDiagnostic(body);
        sendJson(response, saved ? 200 : 500, { ok: saved, path: DIAG_PATH });
        return;
      }

      if (path === "/api/random") {
        if (request.method !== "GET") {
          sendJson(response, 405, { ok: false, error: "method not allowed" });
          return;
        }
        await handleRandom(url.searchParams, response);
        return;
      }

      if (path === "/api/img") {
        await handleImage(url.searchParams, response);
        return;
      }

      sendJson(response, 404, { ok: false, error: "unknown route: " + path });
    } catch (err) {
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false, error: String((err && err.message) || err) });
      } else {
        response.end();
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

export function apply(ctx) {
  const config = readConfig();
  if (!existsSync(CONFIG_PATH)) writeConfig(config);

  // 可选注入：没有 webServer（如 Electron file:// 宿主）时静默降级
  if (typeof ctx.inject !== "function") {
    console.warn("[dsh-anime-theme] ctx.inject 不可用，跳过 HTTP 路由注册");
    return;
  }

  try {
    ctx.inject(["webServer"], (inner) => {
      inner.effect(
        () =>
          inner.webServer.register({
            kind: "prefix",
            path: ROUTE_PREFIX,
            handler: createHandler(),
          }),
        "dsh-anime-theme: routes",
      );
      ctx.logger?.info?.("[dsh-anime-theme] 路由已挂载：%s", ROUTE_PREFIX);
    });
  } catch (err) {
    console.warn("[dsh-anime-theme] webServer 路由注册失败（客户端将退回直连模式）：", err && err.message);
  }
}
