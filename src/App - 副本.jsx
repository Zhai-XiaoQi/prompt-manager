import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SETTINGS_KEY = "prompt-manager-settings-v5";
const DB_NAME = "prompt-manager-fs-db-v2";
const HANDLE_STORE = "handles";
const DEFAULT_DB_FILE = "prompt-manager-db.json";
const DEFAULT_WORKSPACE_ID = "browser-default";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function workspaceStorageKey(id) {
  return `prompt-manager-workspace-${id}`;
}

function isValidItemArray(value) {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof item.id === "string");
}

function parseStoredItems(raw, fallback = []) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return isValidItemArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeTags(input) {
  return String(input || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

function hashString(str) {
  let hash = 0;
  const text = String(str || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getTagColorClass(tag, darkMode) {
  const palettes = darkMode
    ? [
        "bg-sky-500/15 text-sky-300",
        "bg-emerald-500/15 text-emerald-300",
        "bg-violet-500/15 text-violet-300",
        "bg-amber-500/15 text-amber-300",
        "bg-rose-500/15 text-rose-300",
        "bg-cyan-500/15 text-cyan-300",
      ]
    : [
        "bg-sky-100 text-sky-700",
        "bg-emerald-100 text-emerald-700",
        "bg-violet-100 text-violet-700",
        "bg-amber-100 text-amber-700",
        "bg-rose-100 text-rose-700",
        "bg-cyan-100 text-cyan-700",
      ];
  return palettes[hashString(tag) % palettes.length];
}

async function copyText(text) {
  const value = text || "";
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!success) throw new Error("copy failed");
  return true;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  requestAnimationFrame(() => {
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return true;
}

function prettyPermission(value) {
  if (value === "granted") return "已授权";
  if (value === "prompt") return "待确认";
  return "未授权";
}

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDirectoryHandle(key, handle) {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, key);
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function getSavedDirectoryHandle(key) {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(key);
    req.onsuccess = () => {
      db.close();
      resolve(req.result || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

async function clearSavedDirectoryHandle(key) {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function queryDirectoryPermission(handle) {
  if (!handle) return "denied";
  if (!handle.queryPermission) return "granted";
  return handle.queryPermission({ mode: "readwrite" });
}

async function requestDirectoryPermission(handle) {
  if (!handle) return "denied";
  if (!handle.requestPermission) return "granted";
  return handle.requestPermission({ mode: "readwrite" });
}

async function readTextFromHandle(handle, fileName) {
  const fileHandle = await handle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return file.text();
}

async function writeTextToHandle(handle, fileName, text) {
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

function dataURLToImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function fileOrBlobToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function urlToDataURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("图片加载失败");
  const blob = await res.blob();
  return fileOrBlobToDataURL(blob);
}

async function getImageMeta(source) {
  const img = await dataURLToImage(source);
  return { width: img.width, height: img.height };
}

async function cropToDataURL(source, crop) {
  const img = await dataURLToImage(source);
  const canvas = document.createElement("canvas");
  const targetWidth = 1200;
  const targetHeight = 750;
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");

  const baseScale = Math.max(targetWidth / img.width, targetHeight / img.height);
  const scale = baseScale * crop.zoom;
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  const x = (targetWidth - drawWidth) / 2 + crop.offsetX;
  const y = (targetHeight - drawHeight) / 2 + crop.offsetY;

  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(img, x, y, drawWidth, drawHeight);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function createDefaultSettings() {
  return {
    theme: "dark",
    currentWorkspaceId: DEFAULT_WORKSPACE_ID,
    workspaces: [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: "默认仓库",
        type: "browser",
        dbFileName: DEFAULT_DB_FILE,
        lastOpenedAt: new Date().toISOString(),
      },
    ],
  };
}

function runSelfTests() {
  const results = [];
  results.push(normalizeTags("a, b, , c ").length === 3);
  results.push(Array.isArray(parseStoredItems(JSON.stringify([{ id: "1", title: "x" }]))));
  results.push(parseStoredItems("{bad json", [])?.length === 0);
  results.push(isValidItemArray([{ id: "1" }, { id: "2" }]) === true);
  results.push(isValidItemArray([{ nope: 1 }]) === false);
  return results.every(Boolean);
}

const SELF_TEST_OK = runSelfTests();

function Icon({ name, className = "h-4 w-4", stroke = 1.8 }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    viewBox: "0 0 24 24",
    className,
    "aria-hidden": true,
  };

  switch (name) {
    case "search":
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
    case "plus":
      return <svg {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
    case "copy":
      return <svg {...common}><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" /></svg>;
    case "trash":
      return <svg {...common}><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></svg>;
    case "download":
      return <svg {...common}><path d="M12 4v10" /><path d="M8 10l4 4 4-4" /><path d="M4 20h16" /></svg>;
    case "upload":
      return <svg {...common}><path d="M12 20V10" /><path d="M8 14l4-4 4 4" /><path d="M4 4h16" /></svg>;
    case "tag":
      return <svg {...common}><path d="M20 10l-8.5 8.5a2.1 2.1 0 0 1-3 0L3 13V4h9l8 6z" /><circle cx="7.5" cy="7.5" r="1" /></svg>;
    case "image":
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></svg>;
    case "x":
      return <svg {...common}><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>;
    case "moon":
      return <svg {...common}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>;
    case "sun":
      return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M4.9 4.9l1.4 1.4" /><path d="M17.7 17.7l1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="M4.9 19.1l1.4-1.4" /><path d="M17.7 6.3l1.4-1.4" /></svg>;
    case "folder":
      return <svg {...common}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>;
    case "link":
      return <svg {...common}><path d="M10 13a5 5 0 0 0 7.1 0l2.1-2.1a5 5 0 0 0-7.1-7.1L10.5 5.4" /><path d="M14 11a5 5 0 0 0-7.1 0L4.8 13.1a5 5 0 0 0 7.1 7.1l1.6-1.6" /></svg>;
    case "drive":
      return <svg {...common}><rect x="3" y="5" width="18" height="6" rx="2" /><rect x="3" y="13" width="18" height="6" rx="2" /><path d="M7 8h.01" /><path d="M7 16h.01" /></svg>;
    case "refresh":
      return <svg {...common}><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v6h-6" /></svg>;
    case "save":
      return <svg {...common}><path d="M5 21h14" /><path d="M7 21V7h8v14" /><path d="M17 3H7a2 2 0 0 0-2 2v2h14V5a2 2 0 0 0-2-2z" /></svg>;
    case "check":
      return <svg {...common}><path d="M20 6L9 17l-5-5" /></svg>;
    case "database":
      return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>;
    case "crop":
      return <svg {...common}><path d="M6 3v14a1 1 0 0 0 1 1h14" /><path d="M3 6h14a1 1 0 0 1 1 1v14" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" /></svg>;
    case "panel":
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>;
    default:
      return null;
  }
}

function Toast({ toast, onClose, darkMode }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, 2200);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className={cx(
      "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-4 py-3 text-sm shadow-lg",
      darkMode ? "bg-slate-100 text-slate-900" : "bg-slate-900 text-white"
    )}>
      {toast}
    </div>
  );
}

function Modal({ open, title, children, onClose, maxWidth = "max-w-2xl", darkMode = true }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div
        className={cx(
          "w-full rounded-[28px] p-6 shadow-2xl",
          darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900",
          maxWidth
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="text-xl font-semibold">{title}</div>
          <button type="button" className={cx(
            "rounded-xl p-2 transition",
            darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
          )} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusPill({ type = "default", children, darkMode = true }) {
  const styles = darkMode
    ? {
        default: "bg-slate-800 text-slate-200",
        success: "bg-emerald-500/15 text-emerald-300",
        warn: "bg-amber-500/15 text-amber-300",
      }
    : {
        default: "bg-slate-100 text-slate-700",
        success: "bg-emerald-100 text-emerald-700",
        warn: "bg-amber-100 text-amber-700",
      };
  return <span className={cx("rounded-full px-3 py-1 text-xs", styles[type])}>{children}</span>;
}

export default function PromptManagerApp() {
  const [items, setItems] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [tagFilter, setTagFilter] = useState("全部");
  const [showTagFilter, setShowTagFilter] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState("dark");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [settingsState, setSettingsState] = useState(createDefaultSettings());
  const [directoryHandle, setDirectoryHandle] = useState(null);
  const [permissionState, setPermissionState] = useState("denied");
  const [lastSyncTime, setLastSyncTime] = useState("");
  const [coverSourceType, setCoverSourceType] = useState("local");
  const [coverUrl, setCoverUrl] = useState("");
  const [rawCover, setRawCover] = useState("");
  const [rawCoverMeta, setRawCoverMeta] = useState({ width: 0, height: 0 });
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [form, setForm] = useState({ title: "", cover: "", prompt: "", tags: "" });
  const [crop, setCrop] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });

  const importRef = useRef(null);
  const localCoverRef = useRef(null);
  const cropPreviewRef = useRef(null);
  const darkMode = theme === "dark";
  const workspaceSupported = typeof window !== "undefined" && window.isSecureContext && "showDirectoryPicker" in window;

  const currentWorkspace = useMemo(
    () => settingsState.workspaces.find((w) => w.id === settingsState.currentWorkspaceId) || settingsState.workspaces[0],
    [settingsState]
  );

  const notify = useCallback((message) => setToast(message), []);

  const persistSettings = useCallback((next) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSettingsState(next);
  }, []);

  const loadBrowserWorkspaceItems = useCallback((workspaceId) => {
    const parsed = parseStoredItems(localStorage.getItem(workspaceStorageKey(workspaceId)), []);
    setItems(parsed);
    setLastSyncTime("");
    setPermissionState("denied");
    setDirectoryHandle(null);
  }, []);

  const saveBrowserWorkspaceItems = useCallback((workspaceId, list) => {
    localStorage.setItem(workspaceStorageKey(workspaceId), JSON.stringify(list));
  }, []);

  const refreshWorkspaceStatus = useCallback(async (handle, workspace) => {
    if (!handle || workspace?.type !== "folder") {
      setPermissionState("denied");
      return "denied";
    }
    const permission = await queryDirectoryPermission(handle);
    setPermissionState(permission);
    return permission;
  }, []);

  const loadFolderWorkspaceItems = useCallback(async (workspace, handleArg) => {
    const handle = handleArg || directoryHandle;
    if (!workspace || workspace.type !== "folder" || !handle) return false;
    try {
      const permission = await refreshWorkspaceStatus(handle, workspace);
      if (permission !== "granted") return false;
      const text = await readTextFromHandle(handle, workspace.dbFileName || DEFAULT_DB_FILE);
      const parsed = parseStoredItems(text, []);
      setItems(parsed);
      setLastSyncTime(new Date().toISOString());
      return true;
    } catch {
      setItems([]);
      return false;
    }
  }, [directoryHandle, refreshWorkspaceStatus]);

  const saveCurrentWorkspace = useCallback(async () => {
    if (!currentWorkspace) return;
    if (currentWorkspace.type === "browser") {
      saveBrowserWorkspaceItems(currentWorkspace.id, items);
      setLastSyncTime(new Date().toISOString());
      notify("已保存到浏览器本地仓库");
      return;
    }
    if (!directoryHandle) {
      notify("当前文件夹仓库未连接");
      return;
    }
    const permission = await refreshWorkspaceStatus(directoryHandle, currentWorkspace);
    if (permission !== "granted") {
      notify("当前仓库没有写入权限");
      return;
    }
    await writeTextToHandle(directoryHandle, currentWorkspace.dbFileName || DEFAULT_DB_FILE, JSON.stringify(items, null, 2));
    setLastSyncTime(new Date().toISOString());
    notify("已保存到文件夹仓库");
  }, [currentWorkspace, directoryHandle, items, notify, refreshWorkspaceStatus, saveBrowserWorkspaceItems]);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || createDefaultSettings();
    setTheme(saved.theme || "dark");
    setSettingsState(saved);
  }, []);

  useEffect(() => {
    if (!currentWorkspace) return;
    const nextSettings = {
      ...settingsState,
      theme,
      workspaces: settingsState.workspaces.map((w) =>
        w.id === currentWorkspace.id ? { ...w, lastOpenedAt: new Date().toISOString() } : w
      ),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
  }, [theme]);

  useEffect(() => {
    if (!currentWorkspace) return;
    if (currentWorkspace.type === "browser") {
      loadBrowserWorkspaceItems(currentWorkspace.id);
      return;
    }
    (async () => {
      try {
        const handle = await getSavedDirectoryHandle(currentWorkspace.id);
        setDirectoryHandle(handle);
        if (!handle) {
          setItems([]);
          setPermissionState("denied");
          return;
        }
        const ok = await loadFolderWorkspaceItems(currentWorkspace, handle);
        if (!ok) setItems([]);
      } catch {
        setItems([]);
      }
    })();
  }, [currentWorkspace, loadBrowserWorkspaceItems, loadFolderWorkspaceItems]);

  useEffect(() => {
    if (!currentWorkspace || currentWorkspace.type !== "browser") return;
    saveBrowserWorkspaceItems(currentWorkspace.id, items);
  }, [currentWorkspace, items, saveBrowserWorkspaceItems]);

  useEffect(() => {
    if (!open || !cropPreviewRef.current) return;
    const node = cropPreviewRef.current;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setPreviewSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSize);
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [open]);

  const minZoom = useMemo(() => {
    if (!rawCoverMeta.width || !rawCoverMeta.height || !previewSize.width || !previewSize.height) return 1;
    return 1;
  }, [rawCoverMeta, previewSize]);

  const previewBaseScale = useMemo(() => {
    if (!rawCoverMeta.width || !rawCoverMeta.height || !previewSize.width || !previewSize.height) return 1;
    return Math.max(previewSize.width / rawCoverMeta.width, previewSize.height / rawCoverMeta.height);
  }, [rawCoverMeta, previewSize]);

  const allTags = useMemo(() => {
    const s = new Set();
    items.forEach((item) => item.tags?.forEach((tag) => s.add(tag)));
    return ["全部", ...Array.from(s)];
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const k = keyword.trim().toLowerCase();
      const matchKeyword =
        !k ||
        item.title?.toLowerCase().includes(k) ||
        item.prompt?.toLowerCase().includes(k) ||
        item.tags?.some((t) => t.toLowerCase().includes(k));
      const matchTag = tagFilter === "全部" || item.tags?.includes(tagFilter);
      return matchKeyword && matchTag;
    });
  }, [items, keyword, tagFilter]);

  function updateSettings(patchFn) {
    const next = patchFn(settingsState);
    persistSettings(next);
  }

  function resetForm() {
    setEditingId(null);
    setForm({ title: "", cover: "", prompt: "", tags: "" });
    setCoverUrl("");
    setRawCover("");
    setRawCoverMeta({ width: 0, height: 0 });
    setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
    setCoverSourceType("local");
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  function handleEdit(item) {
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      cover: item.cover || "",
      prompt: item.prompt || "",
      tags: (item.tags || []).join(", "),
    });
    setRawCover(item.cover || "");
    setCoverUrl("");
    setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
    if (item.cover) {
      getImageMeta(item.cover).then(setRawCoverMeta).catch(() => setRawCoverMeta({ width: 0, height: 0 }));
    }
    setOpen(true);
  }

  async function handleLocalCoverChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const base64 = await fileOrBlobToDataURL(file);
    setRawCover(base64);
    setRawCoverMeta(await getImageMeta(base64));
    setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
    notify("本地图片已载入，可裁切后应用");
  }

  async function handleLoadUrlCover() {
    if (!coverUrl.trim()) return notify("请先输入图片 URL");
    try {
      const base64 = await urlToDataURL(coverUrl.trim());
      setRawCover(base64);
      setRawCoverMeta(await getImageMeta(base64));
      setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
      notify("网络图片已载入，可裁切后应用");
    } catch {
      notify("图片 URL 加载失败，可能被跨域限制");
    }
  }

  async function applyCrop() {
    if (!rawCover) return notify("请先上传或读取图片");
    try {
      const result = await cropToDataURL(rawCover, crop);
      setForm((prev) => ({ ...prev, cover: result }));
      notify("封面已应用");
    } catch {
      notify("裁切失败");
    }
  }

  async function handleSave() {
    const payload = {
      title: form.title.trim() || "未命名 Prompt",
      cover: form.cover,
      prompt: form.prompt.trim(),
      tags: normalizeTags(form.tags),
    };

    if (!payload.prompt) return notify("请先填写 Prompt");

    if (rawCover) {
      try {
        payload.cover = await cropToDataURL(rawCover, { ...crop, zoom: Math.max(crop.zoom, minZoom) });
      } catch {
        return notify("封面处理失败，请重试");
      }
    }

    if (editingId) {
      setItems((prev) => prev.map((item) => (item.id === editingId ? { ...item, ...payload, updatedAt: Date.now() } : item)));
      notify("已更新");
    } else {
      setItems((prev) => [{ id: uid(), ...payload, createdAt: Date.now() }, ...prev]);
      notify("已添加");
    }

    closeModal();
  }

  async function copyPrompt(text) {
    try {
      await copyText(text || "");
      notify("Prompt 已复制");
    } catch {
      notify("复制失败，请检查浏览器权限或当前页面是否允许复制");
    }
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
    notify("已删除");
  }

  function exportJson() {
    try {
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json;charset=utf-8" });
      triggerDownload(blob, (currentWorkspace?.dbFileName || DEFAULT_DB_FILE));
      notify("已触发导出，请检查浏览器下载栏或下载目录");
    } catch {
      notify("导出失败");
    }
  }

  async function importJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = parseStoredItems(text, null);
      if (!isValidItemArray(data)) throw new Error("invalid");
      setItems(data);
      notify("导入成功");
    } catch {
      notify("JSON 文件格式不正确");
    }
    e.target.value = "";
  }

  function createBrowserWorkspace() {
    const name = newWorkspaceName.trim() || `新仓库 ${settingsState.workspaces.length}`;
    const id = uid();
    const nextWorkspace = {
      id,
      name,
      type: "browser",
      dbFileName: DEFAULT_DB_FILE,
      lastOpenedAt: new Date().toISOString(),
    };
    updateSettings((prev) => ({
      ...prev,
      currentWorkspaceId: id,
      workspaces: [nextWorkspace, ...prev.workspaces],
    }));
    localStorage.setItem(workspaceStorageKey(id), JSON.stringify([]));
    setItems([]);
    setNewWorkspaceName("");
    notify("已创建浏览器仓库");
  }

  async function createFolderWorkspace() {
    if (!workspaceSupported) {
      notify(window.isSecureContext ? "当前环境不支持文件夹仓库" : "文件夹仓库需要 localhost 或 HTTPS" );
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      const permission = await requestDirectoryPermission(handle);
      if (permission !== "granted") return notify("未获得文件夹写入权限");
      const id = uid();
      const name = newWorkspaceName.trim() || handle.name || `文件夹仓库 ${settingsState.workspaces.length}`;
      const workspace = {
        id,
        name,
        type: "folder",
        dbFileName: DEFAULT_DB_FILE,
        lastOpenedAt: new Date().toISOString(),
      };
      await saveDirectoryHandle(id, handle);
      updateSettings((prev) => ({
        ...prev,
        currentWorkspaceId: id,
        workspaces: [workspace, ...prev.workspaces],
      }));
      setDirectoryHandle(handle);
      setPermissionState(permission);
      setWorkspaceOpen(false);
      try {
        const text = await readTextFromHandle(handle, workspace.dbFileName);
        const parsed = parseStoredItems(text, []);
        setItems(parsed);
      } catch {
        await writeTextToHandle(handle, workspace.dbFileName, JSON.stringify([], null, 2));
        setItems([]);
      }
      setLastSyncTime(new Date().toISOString());
      setNewWorkspaceName("");
      notify("已创建文件夹仓库");
    } catch (error) {
      notify(error?.name === "AbortError" ? "已取消选择文件夹" : "创建文件夹仓库失败");
    }
  }

  async function switchWorkspace(workspace) {
    updateSettings((prev) => ({
      ...prev,
      currentWorkspaceId: workspace.id,
      workspaces: prev.workspaces.map((w) =>
        w.id === workspace.id ? { ...w, lastOpenedAt: new Date().toISOString() } : w
      ),
    }));
  }

  async function removeWorkspace(workspaceId) {
    const target = settingsState.workspaces.find((w) => w.id === workspaceId);
    if (!target) return;
    if (settingsState.workspaces.length === 1) return notify("至少保留一个仓库");
    if (target.type === "folder") {
      await clearSavedDirectoryHandle(target.id).catch(() => {});
    } else {
      localStorage.removeItem(workspaceStorageKey(target.id));
    }
    const remain = settingsState.workspaces.filter((w) => w.id !== workspaceId);
    updateSettings((prev) => ({
      ...prev,
      currentWorkspaceId: prev.currentWorkspaceId === workspaceId ? remain[0].id : prev.currentWorkspaceId,
      workspaces: remain,
    }));
    notify("仓库已删除");
  }

  async function reconnectWorkspace() {
    if (!currentWorkspace || currentWorkspace.type !== "folder") return notify("当前仓库不是文件夹仓库");
    try {
      const handle = await getSavedDirectoryHandle(currentWorkspace.id);
      if (!handle) return notify("当前仓库还未绑定文件夹");
      const permission = await requestDirectoryPermission(handle);
      setDirectoryHandle(handle);
      setPermissionState(permission);
      if (permission !== "granted") return notify("未获得仓库权限");
      const ok = await loadFolderWorkspaceItems(currentWorkspace, handle);
      notify(ok ? "已重新读取仓库数据" : "读取失败，请检查文件名或文件内容");
    } catch {
      notify("重新读取失败");
    }
  }

  async function bindCurrentWorkspaceFolder() {
    if (!currentWorkspace || currentWorkspace.type !== "folder") return notify("当前仓库不是文件夹仓库");
    if (!workspaceSupported) return notify("当前环境不支持文件夹仓库");
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      const permission = await requestDirectoryPermission(handle);
      if (permission !== "granted") return notify("未获得文件夹写入权限");
      await saveDirectoryHandle(currentWorkspace.id, handle);
      setDirectoryHandle(handle);
      setPermissionState(permission);
      const ok = await loadFolderWorkspaceItems(currentWorkspace, handle);
      if (!ok) {
        await writeTextToHandle(handle, currentWorkspace.dbFileName || DEFAULT_DB_FILE, JSON.stringify([], null, 2));
        setItems([]);
      }
      notify("已绑定当前仓库文件夹");
    } catch {
      notify("绑定文件夹失败");
    }
  }

  async function renameDbFileAndReload() {
    if (!currentWorkspace) return;
    const next = (currentWorkspace.dbFileName || DEFAULT_DB_FILE).trim() || DEFAULT_DB_FILE;
    updateSettings((prev) => ({
      ...prev,
      workspaces: prev.workspaces.map((w) =>
        w.id === currentWorkspace.id ? { ...w, dbFileName: next } : w
      ),
    }));
    if (currentWorkspace.type === "browser") {
      notify("浏览器仓库已更新数据库文件名");
      return;
    }
    try {
      const handle = await getSavedDirectoryHandle(currentWorkspace.id);
      if (!handle) return notify("当前文件夹仓库未绑定目录");
      const permission = await requestDirectoryPermission(handle);
      if (permission !== "granted") return notify("仓库权限不足");
      try {
        const text = await readTextFromHandle(handle, next);
        const parsed = parseStoredItems(text, []);
        setItems(parsed);
        notify("已切换并读取新数据库文件");
      } catch {
        await writeTextToHandle(handle, next, JSON.stringify(items, null, 2));
        notify("已切换数据库文件名，并创建新文件");
      }
      setLastSyncTime(new Date().toISOString());
    } catch {
      notify("数据库文件切换失败");
    }
  }

  const panelClass = darkMode ? "bg-slate-900 text-slate-100 ring-slate-800" : "bg-white text-slate-900 ring-slate-200/60";
  const subtleText = darkMode ? "text-slate-400" : "text-slate-600";
  const inputClass = darkMode
    ? "border-slate-700 bg-slate-900 text-slate-100 focus:border-slate-500 focus:ring-slate-700"
    : "border-slate-200 bg-white text-slate-900 focus:border-slate-300 focus:ring-slate-200";
  const secondaryBtn = (active = false) =>
    cx(
      "inline-flex items-center rounded-2xl border px-3 py-2 text-sm shadow-sm transition active:scale-[0.98]",
      darkMode
        ? active
          ? "border-slate-500 bg-slate-700 text-white"
          : "border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
        : active
          ? "border-slate-300 bg-slate-200 text-slate-900"
          : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
    );
  const primaryBtn = cx(
    "inline-flex items-center rounded-2xl px-4 py-2 text-sm shadow-sm transition active:scale-[0.98]",
    darkMode ? "bg-blue-500 text-white hover:bg-blue-400" : "bg-blue-600 text-white hover:bg-blue-700"
  );
  const copyBtn = cx(
    "inline-flex items-center rounded-2xl px-4 py-2 text-sm shadow-sm transition active:scale-[0.98]",
    darkMode ? "bg-orange-500 text-white hover:bg-orange-400" : "bg-orange-500 text-white hover:bg-orange-600"
  );
  const chipClass = (active = false) =>
    cx(
      "rounded-full px-3 py-1.5 text-sm transition active:scale-[0.98]",
      darkMode
        ? active ? "bg-white text-slate-900 shadow-sm" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
        : active ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
    );

  return (
    <div className={cx("min-h-screen transition-colors", darkMode ? "bg-[#020817] text-slate-100" : "bg-slate-50 text-slate-900")}>
      <div className={cx("sticky top-0 z-30 border-b backdrop-blur", darkMode ? "border-slate-800 bg-slate-950/85" : "border-slate-200/80 bg-white/90")}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <div className="min-w-0">
            <div className="text-lg font-semibold">Prompt Manager Pro</div>
            <div className={cx("truncate text-xs", subtleText)}>
              {currentWorkspace ? `${currentWorkspace.name} / ${currentWorkspace.dbFileName || DEFAULT_DB_FILE}` : "未选择仓库"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill type={SELF_TEST_OK ? "success" : "warn"} darkMode={darkMode}>{SELF_TEST_OK ? "系统检查正常" : "系统检查异常"}</StatusPill>
            <button type="button" className={secondaryBtn(theme === "dark")} onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}>
              <Icon name={theme === "dark" ? "sun" : "moon"} className="mr-2 h-4 w-4" />
              {theme === "dark" ? "浅色" : "深色"}
            </button>
            <button type="button" className={secondaryBtn()} onClick={exportJson}><Icon name="download" className="mr-2 h-4 w-4" /> 导出</button>
            <button type="button" className={secondaryBtn()} onClick={() => importRef.current?.click()}><Icon name="upload" className="mr-2 h-4 w-4" /> 导入</button>
            <button type="button" className={secondaryBtn()} onClick={saveCurrentWorkspace}><Icon name="save" className="mr-2 h-4 w-4" /> 保存仓库</button>
            <button type="button" className={secondaryBtn(workspaceOpen)} onClick={() => setWorkspaceOpen(true)}><Icon name="settings" className="mr-2 h-4 w-4" /> 设置</button>
            <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={importJson} />
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 p-4 md:grid-cols-[280px_1fr] md:p-8">
        <aside className={cx("h-fit rounded-[28px] p-5 shadow-sm ring-1", panelClass)}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">仓库列表</div>
              <div className={cx("mt-1 text-xs", subtleText)}>类 Obsidian 结构</div>
            </div>
            <button type="button" className={secondaryBtn()} onClick={() => setWorkspaceOpen(true)}>
              <Icon name="plus" className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            {settingsState.workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={cx(
                  "rounded-2xl border p-3 transition",
                  currentWorkspace?.id === workspace.id
                    ? darkMode ? "border-slate-500 bg-slate-800" : "border-slate-300 bg-slate-100"
                    : darkMode ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"
                )}
              >
                <button type="button" className="w-full text-left" onClick={() => switchWorkspace(workspace)}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{workspace.name}</div>
                      <div className={cx("truncate text-xs", subtleText)}>{workspace.type === "folder" ? "文件夹仓库" : "浏览器仓库"}</div>
                    </div>
                    <Icon name={workspace.type === "folder" ? "folder" : "database"} className="h-4 w-4" />
                  </div>
                </button>
                <div className="mt-3 flex gap-2">
                  <button type="button" className={secondaryBtn()} onClick={() => switchWorkspace(workspace)}>打开</button>
                  <button type="button" className={secondaryBtn()} onClick={() => removeWorkspace(workspace.id)}>删除</button>
                </div>
              </div>
            ))}
          </div>

          <div className={cx("mt-5 rounded-2xl p-4", darkMode ? "bg-slate-800/70" : "bg-slate-100")}>
            <div className="mb-2 text-sm font-medium">快速筛选</div>
            <div className="flex flex-wrap gap-2">
              {allTags.slice(0, 8).map((tag) => (
                <button key={tag} type="button" onClick={() => setTagFilter(tag)} className={chipClass(tagFilter === tag)}>{tag}</button>
              ))}
            </div>
          </div>
        </aside>

        <main>
          <div className="mb-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <section className={cx("rounded-[28px] p-6 shadow-sm ring-1 md:p-8", panelClass)}>
              <div className={cx("mb-3 inline-flex items-center rounded-full px-3 py-1 text-xs", darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600")}>Prompt 仓库 / 多工作区</div>
              <h1 className="text-3xl font-semibold tracking-tight">你的 Prompt 资料库</h1>
              <p className={cx("mt-3 max-w-2xl text-sm leading-7", subtleText)}>
                现在支持多仓库切换、浏览器仓库与文件夹仓库并存、顶部手动保存到仓库，更接近 Obsidian 的“侧边栏 + 当前工作区”体验。
              </p>
            </section>

            <section className={cx("rounded-[28px] p-6 shadow-sm ring-1", panelClass)}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className={cx("text-sm", subtleText)}>当前仓库</div>
                  <div className="mt-1 text-xl font-semibold">{currentWorkspace?.name || "未设置仓库"}</div>
                </div>
                <StatusPill type={currentWorkspace?.type === "folder" ? "success" : "warn"} darkMode={darkMode}>
                  {currentWorkspace?.type === "folder" ? "文件夹模式" : "浏览器本地模式"}
                </StatusPill>
              </div>
              <div className={cx("grid gap-3 text-sm", subtleText)}>
                <div className="flex items-center justify-between gap-3"><span>总条目</span><span className={cx("text-lg font-semibold", darkMode ? "text-slate-100" : "text-slate-900")}>{items.length}</span></div>
                <div className="flex items-center justify-between gap-3"><span>标签数</span><span className={cx("text-lg font-semibold", darkMode ? "text-slate-100" : "text-slate-900")}>{Math.max(allTags.length - 1, 0)}</span></div>
                <div className="flex items-center justify-between gap-3"><span>数据库文件</span><span className={cx("truncate", darkMode ? "text-slate-100" : "text-slate-900")}>{currentWorkspace?.dbFileName || DEFAULT_DB_FILE}</span></div>
                <div className="flex items-center justify-between gap-3"><span>权限</span><span className={cx(darkMode ? "text-slate-100" : "text-slate-900")}>{prettyPermission(permissionState)}</span></div>
                <div className="flex items-center justify-between gap-3"><span>最近同步</span><span className={cx("text-right", darkMode ? "text-slate-100" : "text-slate-900")}>{formatDateTime(lastSyncTime)}</span></div>
              </div>
            </section>
          </div>

          <section className={cx("rounded-[28px] shadow-sm ring-1", panelClass)}>
            <div className="p-4 md:p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="relative w-full md:max-w-md">
                  <Icon name="search" className={cx("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", darkMode ? "text-slate-500" : "text-slate-400")} />
                  <input className={cx("w-full rounded-2xl border py-2.5 pl-9 pr-4 text-sm outline-none transition focus:ring-2", inputClass)} placeholder="搜索标题、Prompt、标签" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={primaryBtn} onClick={() => setOpen(true)}><Icon name="plus" className="mr-2 h-4 w-4" /> 新建 Prompt</button>
                  <button type="button" className={secondaryBtn(showTagFilter)} onClick={() => setShowTagFilter((prev) => !prev)}><Icon name="panel" className="mr-2 h-4 w-4" /> 筛选面板</button>
                </div>
              </div>
            </div>
          </section>

          {showTagFilter && (
            <section className={cx("mt-4 rounded-[24px] shadow-sm ring-1", panelClass)}>
              <div className="p-4 md:p-5">
                <div className="mb-3 text-sm font-medium">标签筛选</div>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => (
                    <button key={tag} type="button" onClick={() => setTagFilter(tag)} className={chipClass(tagFilter === tag)}>{tag}</button>
                  ))}
                </div>
              </div>
            </section>
          )}

          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <div key={item.id} className={cx("group overflow-hidden rounded-[28px] shadow-sm ring-1", panelClass)}>
                <div className={cx("aspect-[16/10] overflow-hidden", darkMode ? "bg-slate-800" : "bg-slate-100")}>
                  {item.cover ? <img src={item.cover} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" /> : <div className={cx("flex h-full items-center justify-center", darkMode ? "text-slate-500" : "text-slate-400")}><Icon name="image" className="mr-2 h-5 w-5" /> 无封面</div>}
                </div>
                <div className="p-6">
                  <div className="mb-2 line-clamp-1 text-lg font-semibold">{item.title || "未命名 Prompt"}</div>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {(item.tags || []).length ? item.tags.map((tag) => <span key={tag} className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-xs", getTagColorClass(tag, darkMode))}><Icon name="tag" className="mr-1 h-3 w-3" /> {tag}</span>) : <span className={cx("text-xs", subtleText)}>暂无标签</span>}
                  </div>
                  <div className={cx("rounded-2xl p-4 text-sm leading-6", darkMode ? "bg-slate-800/80 text-slate-300" : "bg-slate-50 text-slate-700")}>
                    <div className="line-clamp-6 whitespace-pre-wrap break-words">{item.prompt}</div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className={copyBtn} onClick={() => copyPrompt(item.prompt)}><Icon name="copy" className="mr-2 h-4 w-4" /> 复制</button>
                    <button type="button" className={secondaryBtn()} onClick={() => handleEdit(item)}>编辑</button>
                    <button type="button" className={secondaryBtn()} onClick={() => removeItem(item.id)}><Icon name="trash" className="mr-2 h-4 w-4" /> 删除</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {!filteredItems.length && (
            <section className={cx("mt-6 rounded-[28px] shadow-sm ring-1", panelClass)}>
              <div className={cx("flex min-h-[220px] flex-col items-center justify-center gap-2 p-8 text-center", subtleText)}>
                <div className="text-lg font-medium">没有找到匹配内容</div>
                <div className="text-sm">试试更换关键词或标签，或者新建一个 Prompt。</div>
              </div>
            </section>
          )}
        </main>
      </div>

      <Modal open={workspaceOpen} title="设置 / 仓库" onClose={() => setWorkspaceOpen(false)} maxWidth="max-w-4xl" darkMode={darkMode}>
        <div className={cx("grid gap-5 text-sm", subtleText)}>
          <div className={cx("grid gap-3 rounded-3xl border p-4", darkMode ? "border-slate-800" : "border-slate-200")}>
            <div className={cx("flex items-center gap-2", darkMode ? "text-slate-100" : "text-slate-900")}><Icon name="settings" className="h-4 w-4" /> 主题</div>
            <div className="flex gap-2">
              <button type="button" className={chipClass(theme === "light")} onClick={() => setTheme("light")}>浅色主题</button>
              <button type="button" className={chipClass(theme === "dark")} onClick={() => setTheme("dark")}>深色主题</button>
            </div>
          </div>

          <div className={cx("grid gap-3 rounded-3xl border p-4", darkMode ? "border-slate-800" : "border-slate-200")}>
            <div className={cx("flex items-center gap-2", darkMode ? "text-slate-100" : "text-slate-900")}><Icon name="panel" className="h-4 w-4" /> 新建仓库</div>
            <div className="flex flex-col gap-2 md:flex-row">
              <input className={cx("w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2", inputClass)} value={newWorkspaceName} onChange={(e) => setNewWorkspaceName(e.target.value)} placeholder="输入仓库名称" />
              <button type="button" className={primaryBtn} onClick={createBrowserWorkspace}><Icon name="database" className="mr-2 h-4 w-4" /> 新建浏览器仓库</button>
              <button type="button" className={secondaryBtn()} onClick={createFolderWorkspace}><Icon name="folder" className="mr-2 h-4 w-4" /> 绑定文件夹仓库</button>
            </div>
          </div>

          <div className={cx("grid gap-3 rounded-3xl border p-4", darkMode ? "border-slate-800" : "border-slate-200")}>
            <div className={cx("flex items-center gap-2", darkMode ? "text-slate-100" : "text-slate-900")}><Icon name="folder" className="h-4 w-4" /> 当前仓库操作</div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={!currentWorkspace || currentWorkspace.type !== "folder"} className={cx(secondaryBtn(), (!currentWorkspace || currentWorkspace.type !== "folder") && "cursor-not-allowed opacity-50")} onClick={bindCurrentWorkspaceFolder}><Icon name="folder" className="mr-2 h-4 w-4" /> 重新绑定目录</button>
              <button type="button" disabled={!currentWorkspace || currentWorkspace.type !== "folder"} className={cx(secondaryBtn(), (!currentWorkspace || currentWorkspace.type !== "folder") && "cursor-not-allowed opacity-50")} onClick={reconnectWorkspace}><Icon name="refresh" className="mr-2 h-4 w-4" /> 重新读取</button>
              <button type="button" className={secondaryBtn()} onClick={() => currentWorkspace && removeWorkspace(currentWorkspace.id)}><Icon name="trash" className="mr-2 h-4 w-4" /> 删除当前仓库</button>
            </div>
            <div className={cx("rounded-2xl p-3", darkMode ? "bg-slate-800/80" : "bg-slate-50")}>
              <div className={cx("mb-1", darkMode ? "text-slate-100" : "text-slate-900")}>当前仓库：{currentWorkspace?.name || "—"}</div>
              <div>模式：{currentWorkspace?.type === "folder" ? "文件夹模式" : "浏览器本地模式"} · 权限：{prettyPermission(permissionState)}</div>
            </div>
          </div>

          <div className={cx("grid gap-3 rounded-3xl border p-4", darkMode ? "border-slate-800" : "border-slate-200")}>
            <div className={cx("flex items-center gap-2", darkMode ? "text-slate-100" : "text-slate-900")}><Icon name="database" className="h-4 w-4" /> 数据库文件</div>
            <div>支持修改当前仓库使用的数据库文件名。</div>
            <div className="flex flex-col gap-2 md:flex-row">
              <input
                className={cx("w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2", inputClass)}
                value={currentWorkspace?.dbFileName || DEFAULT_DB_FILE}
                onChange={(e) => updateSettings((prev) => ({
                  ...prev,
                  workspaces: prev.workspaces.map((w) => w.id === currentWorkspace?.id ? { ...w, dbFileName: e.target.value } : w),
                }))}
                placeholder="例如：my-prompt-db.json"
              />
              <button type="button" className={primaryBtn} onClick={renameDbFileAndReload}><Icon name="save" className="mr-2 h-4 w-4" /> 保存并读取</button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={open} title={editingId ? "编辑 Prompt" : "新建 Prompt"} onClose={closeModal} maxWidth="max-w-5xl" darkMode={darkMode}>
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="grid gap-4">
            <input className={cx("w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2", inputClass)} placeholder="标题，例如：欧美户外跑步 Banner" value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} />
            <textarea className={cx("min-h-[220px] w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2", inputClass)} placeholder="输入 Prompt 内容，可一键复制" value={form.prompt} onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))} />
            <input className={cx("w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2", inputClass)} placeholder="标签，多个用英文逗号分隔，例如：手表, 欧美, banner" value={form.tags} onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))} />

            <div className={cx("grid gap-2 rounded-3xl border p-4", darkMode ? "border-slate-800" : "border-slate-200")}>
              <div className={cx("flex items-center gap-2 text-sm font-medium", darkMode ? "text-slate-100" : "text-slate-900")}>封面来源</div>
              <div className="flex gap-2">
                <button type="button" className={chipClass(coverSourceType === "local")} onClick={() => setCoverSourceType("local")}><Icon name="image" className="mr-2 inline h-4 w-4" /> 本地图片</button>
                <button type="button" className={chipClass(coverSourceType === "url")} onClick={() => setCoverSourceType("url")}><Icon name="link" className="mr-2 inline h-4 w-4" /> URL</button>
              </div>

              {coverSourceType === "local" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={secondaryBtn()} onClick={() => localCoverRef.current?.click()}><Icon name="upload" className="mr-2 h-4 w-4" /> 选择本地图片</button>
                  <input ref={localCoverRef} type="file" accept="image/*" className="hidden" onChange={handleLocalCoverChange} />
                </div>
              ) : (
                <div className="flex flex-col gap-2 md:flex-row">
                  <input className={cx("w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2", inputClass)} placeholder="粘贴图片 URL" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
                  <button type="button" className={primaryBtn} onClick={handleLoadUrlCover}><Icon name="download" className="mr-2 h-4 w-4" /> 读取图片</button>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4">
            <div className={cx("grid gap-3 rounded-3xl border p-4", darkMode ? "border-slate-800" : "border-slate-200")}>
              <div className={cx("flex items-center gap-2 text-sm font-medium", darkMode ? "text-slate-100" : "text-slate-900")}><Icon name="crop" className="h-4 w-4" /> 封面裁切</div>
              <div ref={cropPreviewRef} className={cx("relative aspect-[16/10] overflow-hidden rounded-2xl", darkMode ? "bg-slate-800" : "bg-slate-100")}>
                {rawCover ? (
                  <img
                    src={rawCover}
                    alt="crop preview"
                    className="absolute left-1/2 top-1/2 max-w-none"
                    style={{
                      width: rawCoverMeta.width ? `${rawCoverMeta.width}px` : "auto",
                      height: rawCoverMeta.height ? `${rawCoverMeta.height}px` : "auto",
                      transform: `translate(calc(-50% + ${crop.offsetX}px), calc(-50% + ${crop.offsetY}px)) scale(${Math.max(crop.zoom, minZoom) * previewBaseScale})`,
                      transformOrigin: "center center",
                    }}
                  />
                ) : form.cover ? (
                  <img src={form.cover} alt="cover preview" className="h-full w-full object-cover" />
                ) : (
                  <div className={cx("flex h-full items-center justify-center text-sm", subtleText)}>暂无封面</div>
                )}
              </div>

              <div className="grid gap-3">
                <label className={cx("grid gap-1 text-xs", subtleText)}>缩放：{Math.max(crop.zoom, minZoom).toFixed(2)}<input type="range" min={minZoom} max="3" step="0.01" value={Math.max(crop.zoom, minZoom)} onChange={(e) => setCrop((prev) => ({ ...prev, zoom: Number(e.target.value) }))} /></label>
                <label className={cx("grid gap-1 text-xs", subtleText)}>左右位置：{crop.offsetX}px<input type="range" min="-500" max="500" step="1" value={crop.offsetX} onChange={(e) => setCrop((prev) => ({ ...prev, offsetX: Number(e.target.value) }))} /></label>
                <label className={cx("grid gap-1 text-xs", subtleText)}>上下位置：{crop.offsetY}px<input type="range" min="-350" max="350" step="1" value={crop.offsetY} onChange={(e) => setCrop((prev) => ({ ...prev, offsetY: Number(e.target.value) }))} /></label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} onClick={applyCrop}><Icon name="check" className="mr-2 h-4 w-4" /> 应用封面</button>
                <button type="button" className={secondaryBtn()} onClick={() => { setRawCover(""); setRawCoverMeta({ width: 0, height: 0 }); setForm((prev) => ({ ...prev, cover: "" })); }}><Icon name="x" className="mr-2 h-4 w-4" /> 清空封面</button>
              </div>
            </div>
          </div>
        </div>

        <div className={cx("mt-6 flex justify-end gap-2 border-t pt-4", darkMode ? "border-slate-800" : "border-slate-200")}>
          <button type="button" className={secondaryBtn()} onClick={closeModal}>取消</button>
          <button type="button" className={primaryBtn} onClick={handleSave}>保存</button>
        </div>
      </Modal>

      <Toast toast={toast} onClose={() => setToast("")} darkMode={darkMode} />
    </div>
  );
}
