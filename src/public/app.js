/* Bookeeper 前端：原生 ESM，无构建步骤、无第三方依赖 */

const TABS = ["board", "entry", "config"];

const state = {
  meta: null,
  tab: "board",
  filters: { scope: "all", from: "", to: "", customer: "", model: "", q: "", quick: "month" },
  dashboard: null,
  boardInitialized: false,
  page: 1,
  groupBy: "customer",
  chartMetric: "volume",
  recent: [],
  entry: {
    date: "",
    scope: "pump",
    editingId: null,
    rows: [],
    photo: { dataUrl: "", status: "", busy: false },
  },
  preview: {},
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function fmt(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function ymd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return ymd(date);
}

async function api(path, { method = "GET", body } = {}) {
  const init = { method, credentials: "same-origin", headers: {}, cache: "no-store" };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(path, init);
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (response.status === 401) {
    showLogin();
    throw new Error(payload.error || "请先登录");
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload.data;
}

let toastTimer = null;
function toast(message, isError = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("is-error", Boolean(isError));
  node.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("is-visible"), 2600);
}

function scopeDef(key) {
  return state.meta?.scopes.find((scope) => scope.key === key) || state.meta?.scopes[0] || { key, label: key, fields: [] };
}

/* ---------------------------------------------------------------- 登录 */

function showLogin() {
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
  $("#login-password")?.focus();
}

function showApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("#login-password").value;
  try {
    await api("/api/login", { method: "POST", body: { password } });
    $("#login-error").textContent = "";
    $("#login-password").value = "";
    await afterLogin();
  } catch (error) {
    $("#login-error").textContent = error.message;
  }
});

$("#logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: {} }).catch(() => {});
  state.meta = null;
  showLogin();
});

async function boot() {
  let session = null;
  try {
    session = await api("/api/session");
  } catch {
    session = null;
  }

  if (!session || (session.passwordRequired && !session.authenticated)) {
    showLogin();
    return;
  }
  await afterLogin();
}

async function afterLogin() {
  state.meta = await api("/api/meta");
  state.entry.date = state.meta.today;
  showApp();
  $("#today-label").textContent = state.meta.today;
  switchTab(tabFromHash());
}

/* ---------------------------------------------------------------- 标签页 */

function tabFromHash() {
  const key = location.hash.replace(/^#/, "");
  return TABS.includes(key) ? key : "board";
}

window.addEventListener("hashchange", () => {
  const tab = tabFromHash();
  if (tab !== state.tab) switchTab(tab, { syncHash: false });
});

$("#tabs").addEventListener("click", (event) => {
  const tab = event.target.closest(".tab")?.dataset.tab;
  if (tab) switchTab(tab);
});

function switchTab(tab, { syncHash = true } = {}) {
  if (!TABS.includes(tab)) tab = "board";
  state.tab = tab;

  $$(".tab").forEach((node) => node.classList.toggle("is-active", node.dataset.tab === tab));
  for (const key of TABS) $(`#view-${key}`)?.classList.toggle("hidden", key !== tab);

  if (syncHash && location.hash !== `#${tab}`) history.pushState(null, "", `#${tab}`);
  if (tab !== "board") document.body.classList.remove("health-bad", "health-warn");

  if (tab === "board") renderBoard();
  if (tab === "entry") renderEntry();
  if (tab === "config") renderConfig();
}

/* ---------------------------------------------------------------- 录入页 */

let rowSeq = 0;

function makeRow(patch = {}) {
  return {
    uid: `r${++rowSeq}`,
    id: null,
    scope: state.entry.scope,
    customer_name: "",
    truck_model: "",
    volume: "",
    remark: "",
    amount_override: "",
    auto: null,
    autoError: "",
    autoVolume: null,
    confidence: null,
    uncertain: [],
    raw: "",
    fromOcr: false,
    ...patch,
  };
}

function rowIsEmpty(row) {
  return !row.id && !row.customer_name.trim() && String(row.volume).trim() === "" && !row.remark.trim();
}

function renderEntry() {
  if (!state.entry.rows.length) state.entry.rows = [makeRow()];

  const editing = state.entry.editingId;
  const scope = scopeDef(state.entry.scope);

  $("#view-entry").innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">${editing ? `编辑记录 #${editing}` : "录入"}</h2>
            <p class="card-desc">${
              editing
                ? "改完点右下角保存；想放弃就点“取消编辑”。"
                : "手工填写，或者拍照 / 粘贴一张台账让 AI 先填好——都在同一张表里，核对后一起入库。"
            }</p>
          </div>
          <div class="spacer"></div>
          <div class="entry-tools">
            <div class="segmented" id="scope-switch">
              ${state.meta.scopes
                .map(
                  (item) =>
                    `<button type="button" data-scope="${item.key}" class="${
                      item.key === state.entry.scope ? "is-active" : ""
                    }">${esc(item.label)}</button>`,
                )
                .join("")}
            </div>
            <label class="date-pill">
              <span>日期</span>
              <input type="date" id="entry-date" value="${esc(state.entry.date || state.meta.today)}" />
            </label>
          </div>
        </div>

        ${photoStripHtml()}

        <div id="rows-wrap"></div>

        <div class="entry-foot">
          <button class="btn btn-sm" type="button" id="add-row">＋ 添加一行</button>
          ${editing ? '<button class="btn btn-sm" type="button" id="cancel-edit">取消编辑</button>' : ""}
          <span class="spacer"></span>
          <span class="totals" id="entry-totals"></span>
          <button class="btn btn-sm btn-ghost" type="button" id="clear-rows">清空</button>
          <button class="btn btn-primary" type="button" id="save-rows">${editing ? "保存修改" : "保存"}</button>
        </div>
      </div>

      <div class="card card-tight">
        <div class="card-head">
          <div>
            <h2 class="card-title">最近记录</h2>
            <p class="card-desc">${esc(scope.label)}最近 10 条，点“编辑”会载入上面的表格</p>
          </div>
          <div class="spacer"></div>
          <button class="btn btn-sm" type="button" id="refresh-recent">刷新</button>
        </div>
        <div id="recent-wrap"><div class="empty">加载中…</div></div>
      </div>
    </div>
  `;

  renderRows();
  scheduleAmounts(0);
  refreshRecent();
}

function photoStripHtml() {
  const photo = state.entry.photo;
  const ocr = state.meta.ocr || {};

  return `
    <div class="photo-strip ${photo.dataUrl ? "has-image" : ""}" id="photo-strip" ${photo.busy ? 'aria-busy="true"' : ""}>
      <input type="file" id="photo-file" accept="image/*" capture="environment" hidden />
      ${
        photo.dataUrl
          ? `<img class="photo-thumb" src="${photo.dataUrl}" alt="台账照片" />`
          : `<span class="photo-mark">＋</span>`
      }
      <div class="photo-text">
        <b>${photo.dataUrl ? "图片已就绪" : "拍照 / 粘贴台账"}</b>
        <span class="hint">${
          photo.dataUrl
            ? "点「开始识别」，识别结果会填进下面的表格"
            : "点这里选照片，也可以直接 Ctrl+V 粘贴截图，或把图片拖进来"
        }</span>
      </div>
      <div class="photo-actions">
        ${
          photo.dataUrl
            ? `<button class="btn btn-sm btn-primary" type="button" data-photo-action="run" ${
                ocr.enabled && !photo.busy ? "" : "disabled"
              }>${photo.busy ? "识别中…" : "开始识别"}</button>
               <button class="btn btn-sm" type="button" data-photo-action="clear">移除</button>`
            : `<button class="btn btn-sm" type="button" data-photo-action="pick">选择照片</button>
               <span class="badge">${esc(ocr.model || "qwen3-vl-plus")}</span>`
        }
      </div>
      <span class="photo-status" id="photo-status">${esc(photo.status)}</span>
    </div>
    ${
      ocr.enabled
        ? ""
        : `<div class="notice" style="margin-top:10px"><div class="notice-body">
             服务端没有配置 <code>DASHSCOPE_API_KEY</code>，拍照识别不可用；手工填写不受影响。
           </div></div>`
    }
  `;
}

function rowHtml(row) {
  const scope = scopeDef(row.scope);
  const modelRequired = scope.fields.find((field) => field.key === "truck_model")?.required;
  const flag =
    row.confidence !== null && row.confidence !== undefined && row.confidence < 0.9
      ? `<span class="row-flag" title="识别置信度 ${Math.round(row.confidence * 100)}%${
          row.uncertain?.length ? `；不确定：${esc(row.uncertain.join("、"))}` : ""
        }${row.raw ? `\n原文：${esc(row.raw)}` : ""}">?</span>`
      : "";

  return `
    <tr data-row="${row.uid}" class="${row.id ? "is-editing" : ""}">
      <td data-label="表">
        <select class="scope-select" data-uid="${row.uid}" data-field="scope">
          ${state.meta.scopes
            .map(
              (item) =>
                `<option value="${item.key}"${item.key === row.scope ? " selected" : ""}>${esc(item.label)}</option>`,
            )
            .join("")}
        </select>
      </td>
      <td class="cell-customer" data-label="客户">
        <input type="text" data-dict="customer" data-uid="${row.uid}" data-field="customer_name" value="${esc(
          row.customer_name,
        )}" placeholder="客户名称" />${flag}
      </td>
      <td data-label="车型">
        <input type="text" data-dict="truck_model" data-uid="${row.uid}" data-field="truck_model" value="${esc(
          row.truck_model,
        )}" placeholder="${modelRequired ? "必填，如 二号" : "选填"}" />
      </td>
      <td class="num" data-label="方量">
        <input class="num-input" type="number" step="0.001" min="0" data-uid="${row.uid}" data-field="volume" value="${esc(
          row.volume,
        )}" placeholder="0" />
      </td>
      <td data-label="备注">
        <input type="text" data-uid="${row.uid}" data-field="remark" value="${esc(
          String(row.remark).replace(/\r?\n/g, " / "),
        )}" placeholder="${row.scope === "mixer" ? "算式或说明，如 12×3" : "选填"}" />
      </td>
      <td class="num" data-label="金额">
        <div class="amount-cell">
          <span class="amount-auto" data-auto="${row.uid}">—</span>
          <input class="amount-manual" type="number" step="0.01" min="0" data-uid="${row.uid}" data-field="amount_override" value="${esc(
            row.amount_override,
          )}" placeholder="改写" title="留空按公式计算；填了就以此为准" />
        </div>
      </td>
      <td class="num" data-label="">
        <button class="btn btn-sm btn-ghost row-del" type="button" data-remove="${row.uid}" title="删除这一行">✕</button>
      </td>
    </tr>
  `;
}

function renderRows() {
  const wrap = $("#rows-wrap");
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="table-wrap entry-table-wrap stack-wrap">
      <table class="table entry-table stack-mobile">
        <colgroup>
          <col style="width:96px" />
          <col style="width:230px" />
          <col style="width:150px" />
          <col style="width:112px" />
          <col />
          <col style="width:134px" />
          <col style="width:44px" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-scope">表</th>
            <th>客户名称</th>
            <th>车型</th>
            <th class="num">方量</th>
            <th>备注</th>
            <th class="num">金额</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${state.entry.rows.map((row) => rowHtml(row)).join("")}</tbody>
      </table>
    </div>
  `;

  updateAmountCells();
  updateTotals();
}

function findRow(uid) {
  return state.entry.rows.find((row) => row.uid === uid);
}

function updateAmountCells() {
  for (const row of state.entry.rows) {
    const auto = $(`[data-auto="${row.uid}"]`);
    if (auto) {
      auto.textContent = row.autoError ? "公式错误" : row.auto === null ? "—" : fmt(row.auto);
      auto.classList.toggle("is-error", Boolean(row.autoError));
      if (row.autoError) auto.title = row.autoError;
      else auto.removeAttribute("title");
    }
    const manual = $(`[data-field="amount_override"][data-uid="${row.uid}"]`);
    if (manual) {
      // 手改金额的输入框始终可见可填，不随这一行有没有字而隐藏
      manual.classList.toggle("is-manual", String(row.amount_override).trim() !== "");
    }
  }
}

function updateTotals() {
  const rows = state.entry.rows.filter((row) => !rowIsEmpty(row));
  let volume = 0;
  let amount = 0;
  for (const row of rows) {
    const raw = String(row.volume).trim();
    const value = raw === "" ? Number(row.autoVolume) : Number(raw);
    if (Number.isFinite(value)) volume += value;
    const override = String(row.amount_override).trim();
    const effective = override === "" ? row.auto : Number(override);
    if (Number.isFinite(Number(effective))) amount += Number(effective);
  }

  const node = $("#entry-totals");
  if (node) {
    node.innerHTML = rows.length
      ? `合计 <b>${rows.length}</b> 条 · <b>${fmt(volume, 2)}</b> 方 · <b>${fmt(amount)}</b> 元`
      : "";
  }

  const button = $("#save-rows");
  if (button && !button.disabled) {
    button.textContent = state.entry.editingId ? "保存修改" : rows.length > 1 ? `保存 ${rows.length} 条` : "保存";
  }
}

let amountTimer = null;
let amountToken = 0;

function scheduleAmounts(delay = 320) {
  clearTimeout(amountTimer);
  amountTimer = setTimeout(() => void computeAmounts(), delay);
}

async function computeAmounts() {
  const token = ++amountToken;

  for (const row of state.entry.rows) {
    if (rowIsEmpty(row)) {
      row.auto = null;
      row.autoError = "";
      row.autoVolume = null;
      continue;
    }

    const formula = state.meta.formulas[row.scope] || {};
    const values = {
      entry_date: state.entry.date || state.meta.today,
      customer_name: row.customer_name,
      truck_model: row.truck_model,
      remark: row.remark,
    };

    try {
      let volume = String(row.volume).trim() === "" ? null : Number(row.volume);
      if (!Number.isFinite(volume)) volume = null;

      if (volume === null) {
        const derived = await api("/api/evaluate", {
          method: "POST",
          body: { scope: row.scope, expression: formula.volume_formula, ...values },
        });
        if (token !== amountToken) return;
        volume = derived.ok && Number(derived.value) > 0 ? Number(derived.value) : null;
      }

      const result = await api("/api/evaluate", {
        method: "POST",
        body: { scope: row.scope, expression: formula.amount_formula, ...values, volume: volume ?? 0 },
      });
      if (token !== amountToken) return;

      row.autoVolume = volume;
      row.auto = result.ok ? Number(result.value) : null;
      row.autoError = result.ok ? "" : result.error;
    } catch (error) {
      if (token !== amountToken) return;
      row.auto = null;
      row.autoError = error.message;
    }
  }

  if (token !== amountToken) return;
  updateAmountCells();
  updateTotals();
}

async function rememberDicts(row) {
  const scope = scopeDef(row.scope);
  for (const field of scope.fields) {
    if (field.type !== "dict") continue;
    const value = String(row[field.key] || "").trim();
    if (!value) continue;
    const list = state.meta.dicts[field.dict] || [];
    if (list.some((item) => item.label === value)) continue;
    try {
      const item = await api("/api/dicts", { method: "POST", body: { kind: field.dict, scope: scope.key, label: value } });
      list.push(item);
      state.meta.dicts[field.dict] = list;
    } catch {
      /* 自动补字典失败不影响主流程 */
    }
  }
}

async function saveRows() {
  const rows = state.entry.rows.filter((row) => !rowIsEmpty(row));
  if (!rows.length) {
    toast("先填一行再保存", true);
    return;
  }

  const button = $("#save-rows");
  if (button) button.disabled = true;

  const date = state.entry.date || state.meta.today;
  let saved = 0;
  const failed = [];

  for (const row of rows) {
    const payload = {
      scope: row.scope,
      entry_date: date,
      customer_name: row.customer_name.trim(),
      truck_model: row.truck_model.trim(),
      remark: row.remark.trim(),
    };
    if (String(row.volume).trim() !== "") payload.volume = Number(row.volume);
    if (String(row.amount_override).trim() !== "") payload.amount_override = Number(row.amount_override);

    try {
      if (row.id) await api(`/api/records/${row.id}`, { method: "PUT", body: payload });
      else await api("/api/records", { method: "POST", body: payload });
      saved += 1;
      await rememberDicts(row);
    } catch (error) {
      failed.push({ row, error: error.message });
    }
  }

  if (button) button.disabled = false;

  if (failed.length) {
    const position = state.entry.rows.findIndex((row) => row.uid === failed[0].row.uid) + 1;
    toast(`${saved ? `已保存 ${saved} 条；` : ""}第 ${position} 行失败：${failed[0].error}`, true);
    const keep = new Set(failed.map((item) => item.row.uid));
    state.entry.rows = state.entry.rows.filter((row) => keep.has(row.uid));
    state.entry.editingId = null;
    renderRows();
    scheduleAmounts(0);
    if (saved) refreshRecent();
    return;
  }

  toast(`已保存 ${saved} 条`);
  state.entry.rows = [makeRow()];
  state.entry.editingId = null;
  state.entry.photo = { dataUrl: "", status: "", busy: false };
  renderEntry();
}

function loadRecordIntoEntry(record) {
  state.entry.scope = record.scope;
  state.entry.date = record.entry_date || state.meta.today;
  state.entry.editingId = record.id;
  state.entry.rows = [
    makeRow({
      id: record.id,
      scope: record.scope,
      customer_name: record.customer_name || "",
      truck_model: record.truck_model || "",
      volume: record.volume === null || record.volume === undefined ? "" : String(record.volume),
      remark: record.remark || "",
      amount_override:
        record.amount_override === null || record.amount_override === undefined ? "" : String(record.amount_override),
    }),
  ];
  switchTab("entry");
  setTimeout(() => {
    $("#rows-wrap")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $('[data-field="customer_name"]')?.focus();
  }, 60);
}

function cancelEdit() {
  state.entry.editingId = null;
  state.entry.rows = [makeRow()];
  renderEntry();
}

async function refreshRecent() {
  const wrap = $("#recent-wrap");
  if (!wrap) return;

  try {
    const data = await api(`/api/records?scope=${encodeURIComponent(state.entry.scope)}&limit=10`);
    state.recent = data.rows;
    if (!data.rows.length) {
      wrap.innerHTML = `<div class="empty">还没有记录，先在上方填一条吧</div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="table-wrap list-table-wrap">
        <table class="table">
          <thead><tr>
            <th>日期</th><th>客户名称</th><th>车型</th><th class="num">方量</th>
            <th class="num">金额</th><th>备注</th><th class="num col-actions">操作</th>
          </tr></thead>
          <tbody>
            ${data.rows
              .map(
                (row) => `
              <tr>
                <td data-label="日期">${esc(row.entry_date)}</td>
                <td class="strong" data-label="客户">${esc(row.customer_name)}</td>
                <td data-label="车型">${esc(row.truck_model) || "—"}</td>
                <td class="num" data-label="方量">${fmt(row.volume, 3)}</td>
                <td class="num strong" data-label="金额">${fmt(row.amount)}${
                  row.amount_source === "manual" ? ' <span class="badge badge-warn">手动</span>' : ""
                }</td>
                <td class="wrap muted" data-label="备注">${esc(row.remark) || "—"}</td>
                <td data-label="" class="col-actions">
                  <div class="row-actions">
                    <button class="btn btn-sm" type="button" data-edit="${row.id}">编辑</button>
                    <button class="btn btn-sm btn-danger" type="button" data-delete="${row.id}">删除</button>
                  </div>
                </td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="mob-list">
        ${data.rows
          .map(
            (row) => `
          <div class="mob-row">
            <div class="mob-title"><b>${esc(row.customer_name)}</b>${
              row.truck_model ? `<span class="badge">${esc(row.truck_model)}</span>` : ""
            }</div>
            <div class="mob-side"><span class="mob-amount">${fmt(row.amount)}<small>元</small></span></div>
            <div class="mob-sub">${esc(row.entry_date)} · ${fmt(row.volume, 2)} 方${
              row.remark ? ` · ${esc(row.remark)}` : ""
            }${row.amount_source === "manual" ? ' · <span class="badge badge-warn">手动</span>' : ""}</div>
            <div class="mob-actions">
              <button class="btn btn-sm" type="button" data-edit="${row.id}">编辑</button>
              <button class="btn btn-sm btn-danger" type="button" data-delete="${row.id}">删除</button>
            </div>
          </div>`,
          )
          .join("")}
      </div>
    `;
  } catch (error) {
    wrap.innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`;
  }
}

async function deleteRecord(id, after) {
  if (!window.confirm(`确定删除记录 #${id}？删除后不可恢复。`)) return;
  try {
    await api(`/api/records/${id}`, { method: "DELETE" });
    toast("已删除");
    await after();
  } catch (error) {
    toast(error.message, true);
  }
}

/* ---------------------------------------------------------------- 名称候选 */

/**
 * 客户 / 车型的候选列表（替代原生 datalist）：
 * - 刚聚焦时列出**全部**候选，不管框里已经有什么字；
 * - 一旦开始输入，就按框里的内容筛选；
 * - 清空内容回到全部；也可以不选，直接打新的名字。
 */

let suggestNode = null;
let suggestInput = null;
let suggestItems = [];
let suggestIndex = -1;
let suggestQuery = "";
let suggestApplying = false;

function suggestOptions(kind) {
  return (state.meta?.dicts?.[kind] || []).map((item) => item.label);
}

function ensureSuggestNode() {
  if (suggestNode) return suggestNode;

  suggestNode = document.createElement("div");
  suggestNode.className = "suggest hidden";
  // mousedown 先兜住，点候选时输入框不会失焦
  suggestNode.addEventListener("mousedown", (event) => event.preventDefault());
  suggestNode.addEventListener("click", (event) => {
    const item = event.target.closest(".suggest-item");
    if (item) applySuggest(item.dataset.value);
  });
  document.body.appendChild(suggestNode);
  return suggestNode;
}

function positionSuggest() {
  const node = suggestNode;
  const input = suggestInput;
  if (!node || !input || !input.isConnected || node.classList.contains("hidden")) return;

  const rect = input.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(Math.max(rect.width, 180), window.innerWidth - margin * 2);
  node.style.width = `${width}px`;
  node.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;

  const below = window.innerHeight - rect.bottom - margin;
  const above = rect.top - margin;
  node.style.maxHeight = `${Math.max(120, Math.min(260, Math.max(below, above) - 4))}px`;

  if (below < 150 && above > below) {
    node.style.top = "auto";
    node.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    node.style.bottom = "auto";
    node.style.top = `${rect.bottom + 4}px`;
  }
}

function renderSuggest(query = suggestQuery) {
  const node = ensureSuggestNode();
  const input = suggestInput;

  if (!input || !input.isConnected || !state.meta) {
    closeSuggest();
    return;
  }

  suggestQuery = String(query ?? "");
  const keyword = suggestQuery.trim().toLowerCase();
  const all = suggestOptions(input.dataset.dict);
  suggestItems = keyword ? all.filter((label) => label.toLowerCase().includes(keyword)) : all;
  if (suggestIndex >= suggestItems.length) suggestIndex = -1;

  node.innerHTML = suggestItems.length
    ? suggestItems
        .map(
          (label, index) =>
            `<button type="button" class="suggest-item${
              index === suggestIndex ? " is-active" : ""
            }" data-value="${esc(label)}">${esc(label)}</button>`,
        )
        .join("")
    : `<div class="suggest-empty">${
        keyword ? "没有匹配的，直接输入新名称即可" : "还没有候选项，直接输入即可"
      }</div>`;

  node.classList.remove("hidden");
  positionSuggest();
  node.querySelector(".suggest-item.is-active")?.scrollIntoView({ block: "nearest" });
}

function openSuggest(input) {
  if (!input?.dataset?.dict || !state.meta) return;
  suggestInput = input;
  suggestIndex = -1;
  suggestQuery = "";
  renderSuggest(""); // 聚焦先给全部
}

function closeSuggest() {
  if (suggestNode) suggestNode.classList.add("hidden");
  suggestIndex = -1;
  suggestItems = [];
  suggestQuery = "";
}

function moveSuggest(step) {
  if (!suggestItems.length) return;
  suggestIndex = (suggestIndex + step + suggestItems.length) % suggestItems.length;
  renderSuggest(suggestQuery);
}

function applySuggest(value) {
  const input = suggestInput;
  if (!input) return;

  suggestApplying = true;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  suggestApplying = false;

  closeSuggest();
  input.focus();
  input.setSelectionRange?.(value.length, value.length);
}

document.addEventListener("focusin", (event) => {
  const input = event.target.closest?.("input[data-dict]");
  if (input) openSuggest(input);
});

document.addEventListener("focusout", (event) => {
  if (!event.target.closest?.("input[data-dict]")) return;
  setTimeout(() => {
    if (document.activeElement !== suggestInput) closeSuggest();
  }, 120);
});

document.addEventListener("input", (event) => {
  const input = event.target.closest?.("input[data-dict]");
  if (!input || suggestApplying) return;
  if (input !== suggestInput) suggestInput = input;
  suggestIndex = -1;
  renderSuggest(input.value);
});

document.addEventListener("keydown", (event) => {
  const input = event.target.closest?.("input[data-dict]");
  if (!input || input !== suggestInput) return;

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveSuggest(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter" && suggestIndex >= 0) {
    event.preventDefault();
    applySuggest(suggestItems[suggestIndex]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSuggest();
  } else if (event.key === "Tab") {
    closeSuggest();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!suggestNode || suggestNode.classList.contains("hidden")) return;
  if (event.target.closest?.(".suggest") || event.target.closest?.("input[data-dict]")) return;
  closeSuggest();
});

window.addEventListener("resize", closeSuggest);
window.addEventListener("scroll", closeSuggest, true);

/* ---------------------------------------------------------------- 拍照识别 */

async function loadPhotoFile(file) {
  if (!String(file?.type || "").startsWith("image/")) {
    toast("请上传图片文件", true);
    return;
  }

  const manualRows = state.entry.rows.filter((row) => !row.fromOcr && !rowIsEmpty(row));
  if (manualRows.length && !window.confirm("换一张图片会丢掉上一次的识别结果，手工填的内容会保留。继续？")) return;

  try {
    state.entry.photo.status = "正在处理图片…";
    const status = $("#photo-status");
    if (status) status.textContent = "正在处理图片…";
    state.entry.photo.dataUrl = await compressImage(file);
    state.entry.photo.status = "图片已就绪，点「开始识别」";
    state.entry.rows = state.entry.rows.filter((row) => !row.fromOcr);
    if (!state.entry.rows.length) state.entry.rows = [makeRow()];
    renderEntry();
  } catch (error) {
    toast(error.message || "图片处理失败", true);
  }
}

async function compressImage(file, maxSide = 2600, quality = 0.88) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const element = new window.Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("无法解析这张图片"));
    element.src = dataUrl;
  });

  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  if (scale === 1 && dataUrl.length < 1_500_000) return dataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** 粘贴（Ctrl+V）和拖拽都走这里 */
function imageFromClipboard(data) {
  if (!data) return null;
  for (const item of data.items || []) {
    if (item.kind === "file" && String(item.type).startsWith("image/")) {
      return item.getAsFile?.() || null;
    }
  }
  return null;
}

document.addEventListener("paste", async (event) => {
  if (!state.meta || state.tab !== "entry") return;
  const file = imageFromClipboard(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  await loadPhotoFile(file);
});

async function runOcr() {
  const photo = state.entry.photo;
  if (!photo.dataUrl || photo.busy) return;

  photo.busy = true;
  photo.status = "识别中，通常 15–40 秒…";
  renderEntry();

  try {
    const result = await api("/api/ocr", { method: "POST", body: { image: photo.dataUrl } });
    const drafts = result.entries || [];
    if (result.date) state.entry.date = result.date;

    const kept = state.entry.rows.filter((row) => !row.fromOcr && !rowIsEmpty(row));
    const mapped = drafts.map((draft) =>
      makeRow({
        scope: draft.table,
        customer_name: draft.customer || "",
        truck_model: draft.truck_model || "",
        volume: Number(draft.volume) > 0 ? String(draft.volume) : "",
        remark: draft.note || "",
        confidence: draft.confidence ?? null,
        uncertain: draft.uncertain || [],
        raw: draft.raw || "",
        fromOcr: true,
      }),
    );

    state.entry.rows = [...kept, ...mapped];
    state.entry.photo = { dataUrl: "", status: `识别到 ${mapped.length} 条，核对后点保存`, busy: false };
    renderEntry();
    toast(`识别到 ${mapped.length} 条，请核对`);
  } catch (error) {
    state.entry.photo.busy = false;
    state.entry.photo.status = "";
    renderEntry();
    toast(error.message, true);
  }
}

/* ---------------------------------------------------------------- 录入页事件 */

const viewEntry = $("#view-entry");

viewEntry.addEventListener("click", async (event) => {
  const photoAction = event.target.closest("[data-photo-action]")?.dataset.photoAction;
  if (photoAction === "pick") return $("#photo-file")?.click();
  if (photoAction === "run") return runOcr();
  if (photoAction === "clear") {
    state.entry.photo = { dataUrl: "", status: "", busy: false };
    return renderEntry();
  }

  if (event.target.closest("#photo-strip") && !state.entry.photo.dataUrl) {
    $("#photo-file")?.click();
    return;
  }

  const scopeButton = event.target.closest("#scope-switch button");
  if (scopeButton) {
    if (scopeButton.dataset.scope === state.entry.scope) return;
    state.entry.scope = scopeButton.dataset.scope;
    for (const row of state.entry.rows) if (!row.id) row.scope = state.entry.scope;
    renderEntry();
    return;
  }

  if (event.target.closest("#add-row")) {
    state.entry.rows.push(makeRow());
    renderRows();
    const last = $$("#rows-wrap tbody tr").at(-1);
    last?.querySelector('[data-field="customer_name"]')?.focus();
    return;
  }

  if (event.target.closest("#clear-rows")) {
    state.entry.editingId = null;
    state.entry.rows = [makeRow()];
    renderEntry();
    return;
  }

  if (event.target.closest("#cancel-edit")) return cancelEdit();
  if (event.target.closest("#save-rows")) return saveRows();
  if (event.target.closest("#refresh-recent")) return refreshRecent();

  const remove = event.target.closest("[data-remove]")?.dataset.remove;
  if (remove) {
    state.entry.rows = state.entry.rows.filter((row) => row.uid !== remove);
    if (!state.entry.rows.length) state.entry.rows = [makeRow()];
    renderRows();
    scheduleAmounts(0);
    return;
  }

  const editId = event.target.closest("[data-edit]")?.dataset.edit;
  if (editId) {
    const record = state.recent.find((row) => row.id === Number(editId));
    if (record) loadRecordIntoEntry(record);
    return;
  }

  const deleteId = event.target.closest("[data-delete]")?.dataset.delete;
  if (deleteId) await deleteRecord(Number(deleteId), refreshRecent);
});

viewEntry.addEventListener("input", (event) => {
  const input = event.target.closest("[data-uid]");
  if (!input) return;
  const row = findRow(input.dataset.uid);
  if (!row) return;

  const field = input.dataset.field;
  row[field] = input.value;

  if (field === "amount_override") {
    updateAmountCells();
    updateTotals();
  } else {
    scheduleAmounts();
  }
});

viewEntry.addEventListener("change", (event) => {
  const dateInput = event.target.closest("#entry-date");
  if (dateInput) {
    state.entry.date = dateInput.value;
    scheduleAmounts(0);
    return;
  }

  const fileInput = event.target.closest("#photo-file");
  if (fileInput) {
    const file = fileInput.files?.[0];
    if (file) void loadPhotoFile(file);
    fileInput.value = "";
    return;
  }

  const input = event.target.closest("[data-uid]");
  if (!input) return;
  const row = findRow(input.dataset.uid);
  if (!row) return;

  row[input.dataset.field] = input.value;
  if (input.dataset.field === "scope") renderRows();
  scheduleAmounts(0);
});

viewEntry.addEventListener("dragover", (event) => {
  if (!state.meta) return;
  event.preventDefault();
  $("#photo-strip")?.classList.add("is-over");
});

viewEntry.addEventListener("dragleave", (event) => {
  if (event.target.closest("#photo-strip")) $("#photo-strip")?.classList.remove("is-over");
});

viewEntry.addEventListener("drop", async (event) => {
  if (!state.meta) return;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault();
  $("#photo-strip")?.classList.remove("is-over");
  await loadPhotoFile(file);
});

/* ---------------------------------------------------------------- 看板 */

function defaultFilters() {
  const today = state.meta.today;
  return {
    scope: "all",
    from: lunarStartDate() || `${today.slice(0, 8)}01`,
    to: today,
    customer: "",
    model: "",
    q: "",
    quick: "lunarYear",
  };
}

/** 当前农历年正月初一（由服务端按 ICU 中国历算出），拿不到就退回今年 1 月 1 日 */
function lunarStartDate() {
  return state.meta?.lunar?.start || "";
}

function applyQuick(quick) {
  const today = state.meta.today;
  const set = (from, to) => {
    state.filters.from = from;
    state.filters.to = to;
  };

  if (quick === "lunarYear") set(lunarStartDate() || `${today.slice(0, 4)}-01-01`, today);
  else if (quick === "today") set(today, today);
  else if (quick === "yesterday") {
    const yesterday = shiftDate(today, -1);
    set(yesterday, yesterday);
  } else if (quick === "week") set(shiftDate(today, -6), today);
  else if (quick === "month") set(`${today.slice(0, 8)}01`, today);
  else if (quick === "lastMonth") {
    const date = new Date(`${today}T12:00:00`);
    const first = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const last = new Date(date.getFullYear(), date.getMonth(), 0);
    set(ymd(first), ymd(last));
  } else set("", "");

  state.filters.quick = quick;
}

function renderBoard() {
  if (!state.boardInitialized) {
    applyQuick("lunarYear");
    state.boardInitialized = true;
  }

  const options = (kind, selected) =>
    [`<option value="">全部</option>`]
      .concat(
        (state.meta.dicts[kind] || []).map(
          (item) =>
            `<option value="${esc(item.label)}"${item.label === selected ? " selected" : ""}>${esc(item.label)}</option>`,
        ),
      )
      .join("");

  $("#view-board").innerHTML = `
    <div class="stack">
      <div class="card card-tight">
        <form id="filter-form">
          <div class="filter-row">
            <div class="quick-dates" id="quick-dates">
              ${[
                ["lunarYear", state.meta.lunar ? "农历年" : "今年"],
                ["month", "本月"],
                ["lastMonth", "上月"],
                ["week", "近7天"],
                ["today", "今天"],
                ["yesterday", "昨天"],
                ["all", "全部"],
              ]
                .map(
                  ([key, label]) =>
                    `<button type="button" data-quick="${key}" class="${
                      state.filters.quick === key ? "is-active" : ""
                    }">${label}</button>`,
                )
                .join("")}
            </div>
            <label class="field"><span>开始</span><input type="date" id="f-from" value="${esc(state.filters.from)}" /></label>
            <label class="field"><span>结束</span><input type="date" id="f-to" value="${esc(state.filters.to)}" /></label>
          </div>
          <div class="filter-row filter-row-bottom">
            <label class="field"><span>表</span>
              <select id="f-scope">
                <option value="all"${state.filters.scope === "all" ? " selected" : ""}>全部</option>
                ${state.meta.scopes
                  .map(
                    (scope) =>
                      `<option value="${scope.key}"${state.filters.scope === scope.key ? " selected" : ""}>${esc(
                        scope.label,
                      )}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label class="field"><span>客户</span><select id="f-customer">${options("customer", state.filters.customer)}</select></label>
            <label class="field"><span>车型</span><select id="f-model">${options("truck_model", state.filters.model)}</select></label>
            <label class="field grow"><span>搜索</span><input type="search" id="f-q" value="${esc(
              state.filters.q,
            )}" placeholder="客户 / 备注" /></label>
            <div class="btn-row">
              <button class="btn btn-primary" type="submit">查询</button>
              <button class="btn" type="button" id="export-btn">导出 CSV</button>
            </div>
          </div>
        </form>
      </div>

      <div class="kpi-grid" id="kpi-grid"></div>
      <div id="board-body"></div>
    </div>
  `;

  loadDashboard();
}

function readFilters() {
  state.filters.from = $("#f-from")?.value || "";
  state.filters.to = $("#f-to")?.value || "";
  state.filters.scope = $("#f-scope")?.value || "all";
  state.filters.customer = $("#f-customer")?.value || "";
  state.filters.model = $("#f-model")?.value || "";
  state.filters.q = ($("#f-q")?.value || "").trim();
}

function filterParams() {
  const params = new URLSearchParams();
  for (const key of ["scope", "from", "to", "customer", "model", "q"]) {
    if (state.filters[key]) params.set(key, state.filters[key]);
  }
  return params.toString();
}

async function loadDashboard() {
  const grid = $("#kpi-grid");
  if (grid) grid.innerHTML = `<div class="kpi-group"><div class="kpi-skeleton"></div></div>`.repeat(3);

  try {
    state.dashboard = await api(`/api/dashboard?${filterParams()}`);
    state.page = 1;
    renderBoardBody();
  } catch (error) {
    const body = $("#board-body");
    if (body) body.innerHTML = `<div class="card"><div class="empty">加载失败：${esc(error.message)}</div></div>`;
  }
}

function renderBoardBody() {
  const data = state.dashboard;
  if (!data) return;

  const kpi = data.kpi;
  const pump = data.scopes?.pump || { count: 0, volume: 0, amount: 0 };
  const mixer = data.scopes?.mixer || { count: 0, volume: 0, amount: 0 };
  const totalVolume = pump.volume + mixer.volume || 1;
  const pumpShare = Math.round((pump.volume / totalVolume) * 100);

  $("#kpi-grid").innerHTML = `
    <div class="kpi-group is-accent">
      <div class="kpi-group-head">总计 <span class="kpi-range">${esc(rangeLabel())}</span></div>
      <div class="kpi-row"><span>总方量</span><b>${fmt(kpi.volume, 3)}<small>方</small></b></div>
      <div class="kpi-row"><span>总金额</span><b>${fmt(kpi.amount)}<small>元</small></b></div>
    </div>
    <div class="kpi-group">
      <div class="kpi-group-head">泵车</div>
      <div class="kpi-row"><span>方量</span><b>${fmt(pump.volume, 3)}<small>方</small></b></div>
      <div class="kpi-row"><span>记录数</span><b>${pump.count}<small>条</small></b></div>
      <div class="kpi-row"><span>金额</span><b>${fmt(pump.amount)}<small>元</small></b></div>
      <div class="share-bar" title="方量占比 ${pumpShare}%"><span style="width:${pumpShare}%"></span></div>
    </div>
    <div class="kpi-group">
      <div class="kpi-group-head">搅拌车</div>
      <div class="kpi-row"><span>方量</span><b>${fmt(mixer.volume, 3)}<small>方</small></b></div>
      <div class="kpi-row"><span>金额</span><b>${fmt(mixer.amount)}<small>元</small></b></div>
      <div class="share-bar" title="方量占比 ${100 - pumpShare}%"><span class="is-mixer" style="width:${100 - pumpShare}%"></span></div>
    </div>
  `;

  const notices = [];
  if (!data.priceConfigured) {
    notices.push("公式用到了「单价」，但单价表里还没有正数价格，金额可能全是 0（配置 → 单价表）。");
  }
  if (kpi.missingPrices > 0) {
    notices.push(`有 ${kpi.missingPrices} 条记录没有匹配到单价（已按 0 计算）。`);
  }
  if (kpi.amountErrors > 0) {
    notices.push(`有 ${kpi.amountErrors} 条记录的金额公式计算失败，请检查公式或数据。`);
  }

  // 数据健康用背景色表达：红=公式有错，黄=缺单价，正常则用默认底色
  const health = kpi.amountErrors > 0 ? "bad" : kpi.missingPrices > 0 ? "warn" : "";
  document.body.classList.toggle("health-bad", health === "bad");
  document.body.classList.toggle("health-warn", health === "warn");

  const groups = [
    ["customer", "按客户"],
    ["model", "按车型"],
    ["date", "按日期"],
    ["scope", "按表"],
  ];

  $("#board-body").innerHTML = `
    ${notices
      .map((text) => `<div class="card card-tight"><div class="notice"><div class="notice-body">${esc(text)}</div></div></div>`)
      .join("")}

    <div class="card card-tight">
      <div class="card-head">
        <div>
          <h2 class="card-title">明细</h2>
          <p class="card-desc" id="detail-desc">按天翻页</p>
        </div>
        <div class="spacer"></div>
        <div class="day-nav" id="day-nav"></div>
      </div>
      <div id="detail-table"></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">汇总</h2><p class="card-desc">按客户 / 车型 / 日期 / 表汇总方量与金额</p></div>
        <div class="spacer"></div>
        <div class="segmented" id="chart-metric">
          ${[
            ["volume", "方量"],
            ["amount", "金额"],
          ]
            .map(
              ([key, label]) =>
                `<button type="button" data-metric="${key}" class="${
                  state.chartMetric === key ? "is-active" : ""
                }">${label}</button>`,
            )
            .join("")}
        </div>
        <div class="segmented" id="group-tabs">
          ${groups
            .map(
              ([key, label]) =>
                `<button type="button" data-group="${key}" class="${state.groupBy === key ? "is-active" : ""}">${label}</button>`,
            )
            .join("")}
        </div>
      </div>
      <div id="chart"></div>
      <div id="group-table"></div>
    </div>
  `;

  renderChart();
  renderGroupTable();
  renderDetailTable();
}

function rangeLabel() {
  const { from, to, quick } = state.filters;
  const lunar = state.meta?.lunar;
  if (!from && !to) return "全部时间";
  if (quick === "lunarYear" && lunar) {
    return `${lunar.label}（${lunar.zodiac}）· ${from} 起`; // 例如「农历丙午年（马）· 2026-02-17 起」
  }
  if (from === to) return from;
  return `${from || "开始"} ~ ${to || "今天"}`;
}

function renderChart() {
  const wrap = $("#chart");
  if (!wrap) return;

  const rows = (state.dashboard?.groups?.date || []).filter((row) => row.key !== "未填日期");
  if (rows.length < 2) {
    wrap.innerHTML = "";
    return;
  }

  // 跨度超过两个月就按月聚合，否则按日（农历年视图下按日会把 9 个月压成 16 根柱子）
  const spanDays = (Date.parse(rows.at(-1).key) - Date.parse(rows[0].key)) / 86400000;
  const byMonth = spanDays > 62;
  const list = byMonth ? monthBuckets(rows) : rows.slice(-16);

  const metric = state.chartMetric;
  const pick = (row) => (metric === "amount" ? row.amount : row.volume);
  const max = Math.max(...list.map(pick), 1);
  const label = (row) => (byMonth ? `${Number(row.key.slice(5, 7))}月` : row.key.slice(5));

  wrap.innerHTML = `
    <div class="chart-caption">${byMonth ? "按月" : "按日"}${metric === "amount" ? "金额" : "方量"}${
      byMonth ? `（最近 ${list.length} 个月）` : ""
    }</div>
    <div class="chart-bars">
      ${list
        .map((row) => {
          const height = Math.max(4, (pick(row) / max) * 100);
          return `<div class="chart-col" title="${esc(row.key)}：${fmt(row.volume, 3)} 方 · ${fmt(row.amount)} 元">
            <span class="chart-value">${metric === "amount" ? fmt(row.amount) : fmt(row.volume, 1)}</span>
            <span class="chart-bar" style="height:${height.toFixed(1)}%"></span>
            <span class="chart-x">${esc(label(row))}</span>
          </div>`;
        })
        .join("")}
    </div>
  `;
}

function monthBuckets(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = row.key.slice(0, 7);
    const current = buckets.get(key) || { key, count: 0, volume: 0, amount: 0 };
    current.count += row.count;
    current.volume += row.volume;
    current.amount += row.amount;
    buckets.set(key, current);
  }
  return [...buckets.values()].slice(-12);
}

function renderGroupTable() {
  const data = state.dashboard;
  const rows = data.groups[state.groupBy] || [];
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0) || 1;

  $("#group-table").innerHTML = rows.length
    ? `<div class="table-wrap list-table-wrap">
        <table class="table">
          <thead><tr><th>名称</th><th class="num">记录数</th><th class="num">方量</th><th class="num">金额</th><th>金额占比</th></tr></thead>
          <tbody>
            ${rows
              .map((row) => {
                const percent = (row.amount / totalAmount) * 100;
                return `
              <tr>
                <td class="strong">${esc(row.key) || "—"}</td>
                <td class="num">${row.count}</td>
                <td class="num">${fmt(row.volume, 3)}</td>
                <td class="num strong">${fmt(row.amount)}</td>
                <td>
                  <div class="share">
                    <div class="bar"><span style="width:${Math.max(2, percent).toFixed(1)}%"></span></div>
                    <span class="pct">${percent.toFixed(1)}%</span>
                  </div>
                </td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="mob-list">
        ${rows
          .map((row) => {
            const percent = (row.amount / totalAmount) * 100;
            return `
          <div class="mob-row">
            <div class="mob-title"><b>${esc(row.key) || "—"}</b></div>
            <div class="mob-side"><span class="mob-amount">${fmt(row.amount)}<small>元</small></span></div>
            <div class="mob-sub">${row.count} 条 · ${fmt(row.volume, 2)} 方</div>
            <div class="mob-bar">
              <div class="share">
                <div class="bar"><span style="width:${Math.max(2, percent).toFixed(1)}%"></span></div>
                <span class="pct">${percent.toFixed(1)}%</span>
              </div>
            </div>
          </div>`;
          })
          .join("")}
      </div>`
    : `<div class="empty">当前筛选条件下没有数据</div>`;
}

function dayGroups(rows) {
  const groups = [];
  let current = null;
  for (const row of rows) {
    const key = row.entry_date || "未填日期";
    if (!current || current.key !== key) {
      current = { key, rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  }
  return groups;
}

function renderDetailTable() {
  const data = state.dashboard;
  const days = dayGroups(data.rows || []);
  const totalPages = Math.max(1, days.length);
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;

  const day = days[state.page - 1];
  const slice = day ? day.rows : [];
  const totalCount = (data.rows || []).length;

  const desc = $("#detail-desc");
  if (desc) {
    if (!days.length) {
      desc.innerHTML = "当前筛选条件下没有数据";
    } else {
      const dayVolume = slice.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
      const dayAmount = slice.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
      desc.innerHTML = `<b>${esc(day.key)}</b> · ${slice.length} 条 · ${fmt(dayVolume, 2)} 方 · ${fmt(
        dayAmount,
      )} 元 <span class="muted">（共 ${totalCount} 条 / ${days.length} 天）</span>`;
    }
  }

  $("#detail-table").innerHTML = slice.length
    ? `<div class="table-wrap list-table-wrap">
        <table class="table">
          <thead><tr>
            <th>表</th><th>车型</th><th>客户名称</th><th class="num">方量</th>
            <th class="num">金额</th><th>备注</th><th class="num col-actions">操作</th>
          </tr></thead>
          <tbody>
            ${slice
              .map(
                (row) => `
              <tr>
                <td><span class="badge badge-${row.scope === "pump" ? "pump" : "mixer"}">${esc(row.scope_label)}</span></td>
                <td>${esc(row.truck_model) || "—"}</td>
                <td class="strong">${esc(row.customer_name)}</td>
                <td class="num">${fmt(row.volume, 3)}</td>
                <td class="num strong">${
                  row.amount_error ? '<span class="badge badge-danger">公式错误</span>' : fmt(row.amount)
                }${row.amount_source === "manual" ? ' <span class="badge badge-warn">手动</span>' : ""}</td>
                <td class="wrap muted">${esc(row.remark) || "—"}</td>
                <td class="col-actions">
                  <div class="row-actions">
                    <button class="btn btn-sm" type="button" data-edit="${row.id}">编辑</button>
                    <button class="btn btn-sm btn-danger" type="button" data-delete="${row.id}">删除</button>
                  </div>
                </td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="mob-list">
        ${slice
          .map(
            (row) => `
          <div class="mob-row">
            <div class="mob-title"><b>${esc(row.customer_name)}</b><span class="badge badge-${
              row.scope === "pump" ? "pump" : "mixer"
            }">${esc(row.scope_label)}</span>${
              row.truck_model ? `<span class="badge">${esc(row.truck_model)}</span>` : ""
            }</div>
            <div class="mob-side"><span class="mob-amount">${
              row.amount_error ? "错误" : fmt(row.amount)
            }<small>元</small></span></div>
            <div class="mob-sub">${fmt(row.volume, 2)} 方${row.remark ? ` · ${esc(row.remark)}` : ""}</div>
            <div class="mob-actions">
              <button class="btn btn-sm" type="button" data-edit="${row.id}">编辑</button>
              <button class="btn btn-sm btn-danger" type="button" data-delete="${row.id}">删除</button>
            </div>
          </div>`,
          )
          .join("")}
      </div>`
    : `<div class="empty">当前筛选条件下没有数据</div>`;

  const nav = $("#day-nav");
  if (nav) {
    nav.innerHTML = days.length
      ? `<span class="day-count">第 ${state.page} / ${days.length} 天</span>
         <button class="btn btn-sm" type="button" data-page="prev" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
         <button class="btn btn-sm" type="button" data-page="next" ${state.page >= totalPages ? "disabled" : ""}>下一页</button>`
      : "";
  }
}

/* ---------------------------------------------------------------- 看板事件 */

const viewBoard = $("#view-board");

viewBoard.addEventListener("click", async (event) => {
  const quick = event.target.closest("[data-quick]")?.dataset.quick;
  if (quick) {
    applyQuick(quick);
    renderBoard();
    return;
  }

  const group = event.target.closest("[data-group]")?.dataset.group;
  if (group) {
    state.groupBy = group;
    $$("#group-tabs button").forEach((button) => button.classList.toggle("is-active", button.dataset.group === group));
    renderGroupTable();
    return;
  }

  const metric = event.target.closest("[data-metric]")?.dataset.metric;
  if (metric) {
    state.chartMetric = metric;
    $$("#chart-metric button").forEach((button) => button.classList.toggle("is-active", button.dataset.metric === metric));
    renderChart();
    return;
  }

  if (event.target.closest("#export-btn")) {
    readFilters();
    window.location.href = `/api/export.csv?${filterParams()}`;
    return;
  }

  const page = event.target.closest("[data-page]")?.dataset.page;
  if (page) {
    state.page += page === "next" ? 1 : -1;
    renderDetailTable();
    return;
  }

  const editId = event.target.closest("#detail-table [data-edit]")?.dataset.edit;
  if (editId) {
    const record = state.dashboard.rows.find((row) => row.id === Number(editId));
    if (record) loadRecordIntoEntry(record);
    return;
  }

  const deleteId = event.target.closest("#detail-table [data-delete]")?.dataset.delete;
  if (deleteId) await deleteRecord(Number(deleteId), loadDashboard);
});

viewBoard.addEventListener("submit", (event) => {
  if (!event.target.closest("#filter-form")) return;
  event.preventDefault();
  readFilters();
  state.filters.quick = "";
  loadDashboard();
});

/* ---------------------------------------------------------------- 配置页 */

function customerOptions(selected) {
  const items = state.meta.dicts.customer || [];
  return [`<option value=""${selected ? "" : " selected"}>（空）</option>`]
    .concat(
      items.map(
        (item) => `<option value="${esc(item.label)}"${item.label === selected ? " selected" : ""}>${esc(item.label)}</option>`,
      ),
    )
    .join("");
}

function modelOptions(selected) {
  const items = state.meta.dicts.truck_model || [];
  return [`<option value=""${selected ? "" : " selected"}>（空）</option>`]
    .concat(
      items.map(
        (item) => `<option value="${esc(item.label)}"${item.label === selected ? " selected" : ""}>${esc(item.label)}</option>`,
      ),
    )
    .join("");
}

function previewSample(scopeKey) {
  if (!state.preview[scopeKey]) {
    const customers = state.meta.dicts.customer || [];
    const preferred = customers.find((item) => item.label === "蒲发混凝土") || customers[0];
    state.preview[scopeKey] = {
      customer: preferred?.label || "",
      model: (state.meta.dicts.truck_model || [])[0]?.label || "",
      date: state.meta.today,
    };
  }
  return state.preview[scopeKey];
}

function renderConfig() {
  const meta = state.meta;
  const usesPrice = Boolean(meta.usesPrice);

  $("#view-config").innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">金额规则</h2>
            <p class="card-desc">变量就是表格的列名；改公式后下方预览立刻按新规则试算，满意再保存</p>
          </div>
          <div class="spacer"></div>
          <span class="badge">不使用 eval · 语法安全</span>
        </div>
        <div class="rule-grid">${meta.scopes.map((scope) => ruleCardHtml(scope)).join("")}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2 class="card-title">名称选项</h2><p class="card-desc">录入时的候选值；直接输入新名称也会自动收录</p></div>
        </div>
        <div class="config-grid" id="dict-grid">
          ${Object.keys(meta.dictKinds).map((kind) => dictColumnHtml(kind)).join("")}
        </div>
      </div>

      <details class="card details-card" ${usesPrice ? "open" : ""}>
        <summary>
          <span class="card-title">单价表</span>
          <span class="hint">${
            usesPrice ? "公式里的「单价()」按客户 / 车型匹配这里的价格" : "当前公式没有用到「单价」，可以忽略这一节"
          }</span>
        </summary>
        <div class="details-body">
          <form id="price-form">
            <div class="form-grid">
              <label class="field"><span>表</span>
                <select id="p-scope">
                  ${meta.scopes.map((scope) => `<option value="${scope.key}">${esc(scope.label)}</option>`).join("")}
                </select>
              </label>
              <label class="field"><span>客户名称</span>
                <input id="p-customer" type="text" data-dict="customer" placeholder="* = 任意客户" value="*" />
              </label>
              <label class="field"><span>车型</span>
                <input id="p-model" type="text" data-dict="truck_model" placeholder="* = 任意车型" value="*" />
              </label>
              <label class="field"><span>单价（元/方）</span><input id="p-price" type="number" step="0.01" min="0" placeholder="0.00" /></label>
              <label class="field span-2"><span>备注</span><input id="p-note" type="text" placeholder="例如：2026 年 11 月起执行" /></label>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary btn-sm" type="submit">保存单价</button>
              <span class="hint">匹配顺序：客户+车型 → 客户 → 车型 → 全局（*）</span>
            </div>
          </form>
          <div id="price-table" style="margin-top:14px"></div>
        </div>
      </details>
    </div>
  `;

  renderPriceTable();
  for (const scope of meta.scopes) computePreview(scope.key);
}

function ruleCardHtml(scope) {
  const formula = state.meta.formulas[scope.key] || {
    volume_formula: "",
    amount_formula: "",
    amount_decimals: 2,
  };
  const sample = previewSample(scope.key);

  return `
    <div class="rule-card" data-scope="${scope.key}">
      <div class="rule-head">
        <span class="badge badge-${scope.key}">${esc(scope.label)}</span>
        <span class="rule-saved mono" data-saved="${scope.key}" title="当前生效的金额公式">${esc(
          formula.amount_formula,
        )}</span>
      </div>

      <label class="field">
        <span>金额公式</span>
        <input class="formula-input" data-formula="amount_formula" data-scope-input="${scope.key}" value="${esc(
          formula.amount_formula,
        )}" spellcheck="false" autocomplete="off" />
      </label>

      <div class="vars" data-vars="${scope.key}">
        ${state.meta.variables
          .map((name) => `<button class="var-chip" type="button" data-var="${esc(name)}">${esc(name)}</button>`)
          .join("")}
      </div>

      <details class="rule-extra">
        <summary>方量公式 / 小数位 / 可用函数</summary>
        <div class="formula-row">
          <span>方量公式</span>
          <input class="formula-input" data-formula="volume_formula" value="${esc(formula.volume_formula)}" spellcheck="false" autocomplete="off" />
        </div>
        <div class="formula-row">
          <span>金额小数位</span>
          <select data-formula="amount_decimals">
            ${[0, 1, 2, 3, 4]
              .map((n) => `<option value="${n}"${Number(formula.amount_decimals) === n ? " selected" : ""}>${n} 位</option>`)
              .join("")}
          </select>
        </div>
        <div class="func-list">
          ${state.meta.functions.map((fn) => `<div><code>${esc(fn.syntax)}</code><span>${esc(fn.description)}</span></div>`).join("")}
        </div>
      </details>

      <div class="rule-preview">
        <div class="preview-controls">
          <label class="field"><span>试算客户</span>
            <select data-preview="customer" data-preview-scope="${scope.key}">${customerOptions(sample.customer)}</select>
          </label>
          <label class="field"><span>车型</span>
            <select data-preview="model" data-preview-scope="${scope.key}">${modelOptions(sample.model)}</select>
          </label>
          <label class="field"><span>日期</span>
            <input type="date" data-preview="date" data-preview-scope="${scope.key}" value="${esc(sample.date)}" />
          </label>
        </div>
        <div class="preview-result" data-preview="${scope.key}"><div class="empty">试算中…</div></div>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary btn-sm" type="button" data-save-formula="${scope.key}">保存规则</button>
        <button class="btn btn-sm" type="button" data-reset-formula="${scope.key}">恢复默认</button>
        <span class="spacer"></span>
        <span class="hint">金额保留 ${formula.amount_decimals} 位小数</span>
      </div>
    </div>
  `;
}

function dictColumnHtml(kind) {
  const label = state.meta.dictKinds[kind]?.label || kind;
  const items = state.meta.dicts[kind] || [];

  return `
    <div class="dict-column" data-kind="${kind}">
      <h3 class="section-title">${esc(label)}<span class="badge">${items.length}</span></h3>
      <div class="chip-list">
        ${
          items
            .map(
              (item) =>
                `<span class="chip">${esc(item.label)}<button type="button" data-del-dict="${item.id}" title="移除">×</button></span>`,
            )
            .join("") || `<span class="hint">还没有选项</span>`
        }
      </div>
      <div class="inline-add">
        <input type="text" id="new-${kind}" placeholder="新增${esc(label)}" />
        <button class="btn btn-sm" type="button" data-add-dict="${kind}">添加</button>
      </div>
    </div>
  `;
}

const PREVIEW_VOLUMES = [8, 10, 20, 30, 40, 88];
let previewTimers = new Map();

function schedulePreview(scopeKey, delay = 450) {
  clearTimeout(previewTimers.get(scopeKey));
  previewTimers.set(
    scopeKey,
    setTimeout(() => void computePreview(scopeKey), delay),
  );
}

async function computePreview(scopeKey) {
  // 用 .rule-card 限定：录入页的「泵车/搅拌车」按钮也带 data-scope
  const card = $(".rule-card" + `[data-scope="${scopeKey}"]`);
  const target = $(`.preview-result[data-preview="${scopeKey}"]`);
  if (!card || !target) return;

  const expression = card.querySelector('[data-formula="amount_formula"]').value.trim() || "0";
  const sample = previewSample(scopeKey);
  const body = {
    scope: scopeKey,
    expression,
    entry_date: sample.date,
    customer_name: sample.customer,
    truck_model: sample.model,
    remark: "",
  };

  const results = [];
  for (const volume of PREVIEW_VOLUMES) {
    try {
      const result = await api("/api/evaluate", { method: "POST", body: { ...body, volume } });
      results.push({ volume, amount: result.ok ? Number(result.value) : null, error: result.ok ? "" : result.error });
    } catch (error) {
      results.push({ volume, amount: null, error: error.message });
    }
  }

  const ok = results.filter((item) => item.amount !== null);
  if (!ok.length) {
    target.innerHTML = `<div class="empty">${esc(results[0]?.error || "公式无法计算")}</div>`;
    return;
  }

  const max = Math.max(...ok.map((item) => item.amount), 1);

  target.innerHTML = `
    <table class="mini-table">
      <thead><tr><th class="num">方量</th><th class="num">金额</th><th></th></tr></thead>
      <tbody>
        ${results
          .map(
            (item) => `
          <tr>
            <td class="num">${item.volume}</td>
            <td class="num strong">${
              item.amount === null ? `<span class="badge badge-danger">错误</span>` : fmt(item.amount)
            }</td>
            <td class="mini-bar-col"><div class="bar"><span style="width:${
              item.amount === null ? 0 : Math.max(3, (item.amount / max) * 100).toFixed(1)
            }%"></span></div></td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
    <p class="hint preview-note">按「${esc(sample.customer || "空客户")} / ${esc(sample.model || "空车型")} / ${esc(
      sample.date,
    )}」试算</p>
  `;
}

function renderPriceTable() {
  const wrap = $("#price-table");
  if (!wrap) return;
  const prices = state.meta.prices;

  wrap.innerHTML = prices.length
    ? `<div class="table-wrap">
        <table class="table">
          <thead><tr><th>表</th><th>客户名称</th><th>车型</th><th class="num">单价</th><th>备注</th><th class="num">操作</th></tr></thead>
          <tbody>
            ${prices
              .map(
                (price) => `
              <tr>
                <td>${price.scope === "pump" ? "泵车" : "搅拌车"}</td>
                <td>${esc(price.customer_name)}</td>
                <td>${esc(price.truck_model)}</td>
                <td class="num strong">${fmt(price.price)}</td>
                <td class="muted">${esc(price.note) || "—"}</td>
                <td><div class="row-actions"><button class="btn btn-sm btn-danger" type="button" data-del-price="${price.id}">删除</button></div></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="empty">还没有单价</div>`;
}

/* ---------------------------------------------------------------- 配置页事件 */

const viewConfig = $("#view-config");
let lastFormulaInput = null;

viewConfig.addEventListener("click", async (event) => {
  const addKind = event.target.closest("[data-add-dict]")?.dataset.addDict;
  if (addKind) {
    const input = $(`#new-${addKind}`);
    const label = (input?.value || "").trim();
    if (!label) return toast("请输入名称", true);
    try {
      await api("/api/dicts", { method: "POST", body: { kind: addKind, scope: "both", label } });
      toast("已添加");
      await refreshDicts(addKind);
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const delId = event.target.closest("[data-del-dict]")?.dataset.delDict;
  if (delId) {
    if (!window.confirm("删除这个选项？已录入的记录不受影响。")) return;
    const column = event.target.closest(".dict-column");
    const kind = column?.dataset.kind;
    try {
      await api(`/api/dicts/${delId}`, { method: "DELETE" });
      toast("已删除");
      if (kind) await refreshDicts(kind);
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const saveScope = event.target.closest("[data-save-formula]")?.dataset.saveFormula;
  if (saveScope) {
    const card = $(".rule-card" + `[data-scope="${saveScope}"]`);
    const body = {
      scope: saveScope,
      volume_formula: card.querySelector('[data-formula="volume_formula"]').value.trim(),
      amount_formula: card.querySelector('[data-formula="amount_formula"]').value.trim(),
      amount_decimals: Number(card.querySelector('[data-formula="amount_decimals"]').value),
    };
    try {
      await api("/api/formulas", { method: "PUT", body });
      state.meta = await api("/api/meta");
      const saved = $(`[data-saved="${saveScope}"]`);
      if (saved) saved.textContent = state.meta.formulas[saveScope].amount_formula;
      toast("规则已保存");
      computePreview(saveScope);
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }

  const resetScope = event.target.closest("[data-reset-formula]")?.dataset.resetFormula;
  if (resetScope) {
    const defaults = state.meta.formulaDefaults?.[resetScope];
    if (!defaults) return toast("没有默认公式", true);
    const card = $(".rule-card" + `[data-scope="${resetScope}"]`);
    card.querySelector('[data-formula="amount_formula"]').value = defaults.amount_formula;
    card.querySelector('[data-formula="volume_formula"]').value = defaults.volume_formula;
    card.querySelector('[data-formula="amount_decimals"]').value = String(defaults.amount_decimals ?? 2);
    computePreview(resetScope);
    toast("已填入默认公式，记得点保存");
    return;
  }

  const varName = event.target.closest("[data-var]")?.dataset.var;
  if (varName) {
    const card = event.target.closest("[data-scope]");
    const fallback = card.querySelector('[data-formula="amount_formula"]');
    const focused = lastFormulaInput && card.contains(lastFormulaInput) ? lastFormulaInput : fallback;
    insertAtCursor(focused, varName);
    schedulePreview(card.dataset.scope, 200);
    return;
  }

  const delPrice = event.target.closest("[data-del-price]")?.dataset.delPrice;
  if (delPrice) {
    if (!window.confirm("删除这条单价？")) return;
    try {
      await api(`/api/prices/${delPrice}`, { method: "DELETE" });
      toast("已删除");
      state.meta = await api("/api/meta");
      renderPriceTable();
    } catch (error) {
      toast(error.message, true);
    }
  }
});

viewConfig.addEventListener("input", (event) => {
  const input = event.target.closest("[data-formula]");
  if (!input) return;
  const card = input.closest("[data-scope]");
  if (input.dataset.formula === "amount_formula") schedulePreview(card.dataset.scope);
});

viewConfig.addEventListener("focusin", (event) => {
  const input = event.target.closest("[data-formula]");
  if (input) lastFormulaInput = input;
});

viewConfig.addEventListener("change", (event) => {
  const control = event.target.closest("[data-preview]");
  if (!control) return;
  const scopeKey = control.dataset.previewScope;
  const field = control.dataset.preview;
  const sample = previewSample(scopeKey);
  sample[field] = control.value;
  computePreview(scopeKey);
});

viewConfig.addEventListener("submit", async (event) => {
  if (!event.target.closest("#price-form")) return;
  event.preventDefault();

  const body = {
    scope: $("#p-scope").value,
    customer_name: $("#p-customer").value.trim() || "*",
    truck_model: $("#p-model").value.trim() || "*",
    price: Number($("#p-price").value),
    note: $("#p-note").value.trim(),
  };
  if (!Number.isFinite(body.price) || body.price < 0) return toast("单价必须是不小于 0 的数字", true);

  try {
    await api("/api/prices", { method: "POST", body });
    toast("单价已保存");
    $("#p-price").value = "";
    $("#p-note").value = "";
    state.meta = await api("/api/meta");
    renderPriceTable();
  } catch (error) {
    toast(error.message, true);
  }
});

async function refreshDicts(kind) {
  state.meta = await api("/api/meta");
  const column = $(`.dict-column[data-kind="${kind}"]`);
  if (column) column.outerHTML = dictColumnHtml(kind);
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  input.focus();
  input.selectionStart = input.selectionEnd = start + text.length;
}

/* ---------------------------------------------------------------- 启动 */

boot().catch((error) => {
  console.error(error);
  toast(error.message || "初始化失败", true);
});
