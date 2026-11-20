/* Bookeeper 前端：原生 ESM，无构建步骤、无第三方依赖 */

const state = {
  meta: null,
  tab: "entry",
  scope: "pump",
  editingId: null,
  filters: { scope: "all", from: "", to: "", customer: "", model: "", q: "", quick: "month" },
  dashboard: null,
  boardInitialized: false,
  page: 1,
  pageSize: 20,
  groupBy: "customer",
  photo: { dataUrl: "", date: "", drafts: [] },
  photoArchive: { dates: [], date: "", photos: [] },
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
  showApp();
  $("#today-label").textContent = state.meta.today;
  switchTab("entry");
}

/* ---------------------------------------------------------------- 标签页 */

$("#tabs").addEventListener("click", (event) => {
  const tab = event.target.closest(".tab")?.dataset.tab;
  if (tab) switchTab(tab);
});

function switchTab(tab) {
  state.tab = tab;
  $$(".tab").forEach((node) => node.classList.toggle("is-active", node.dataset.tab === tab));
  $("#view-entry").classList.toggle("hidden", tab !== "entry");
  $("#view-photo").classList.toggle("hidden", tab !== "photo");
  $("#view-board").classList.toggle("hidden", tab !== "board");
  $("#view-config").classList.toggle("hidden", tab !== "config");

  if (tab !== "board") {
    document.body.classList.remove("health-bad", "health-warn");
  }

  if (tab === "entry") renderEntry();
  if (tab === "photo") renderPhoto();
  if (tab === "board") renderBoard();
  if (tab === "config") renderConfig();
}

/* ---------------------------------------------------------------- 录入页 */

function currentScope() {
  return state.meta.scopes.find((scope) => scope.key === state.scope) || state.meta.scopes[0];
}

function datalistsHtml() {
  return ["customer", "truck_model"]
    .map((kind) => {
      const options = (state.meta.dicts[kind] || [])
        .map((item) => `<option value="${esc(item.label)}"></option>`)
        .join("");
      return `<datalist id="dl-${kind}">${options}</datalist>`;
    })
    .join("");
}

function fieldHtml(field) {
  const id = `f-${field.key}`;
  const required = field.required ? '<i class="req">*</i>' : "";
  let control = "";

  if (field.type === "date") {
    control = `<input id="${id}" data-field="${field.key}" type="date" value="${esc(state.meta.today)}" />`;
  } else if (field.type === "number") {
    control = `<input id="${id}" data-field="${field.key}" type="number" step="0.01" min="0" placeholder="${esc(
      field.placeholder || "0",
    )}" />`;
  } else if (field.type === "dict") {
    control = `<input id="${id}" data-field="${field.key}" type="text" list="dl-${field.dict}" placeholder="选择或直接输入" />`;
  } else {
    control = `<input id="${id}" data-field="${field.key}" type="text" placeholder="${esc(field.placeholder || "")}" />`;
  }

  const wide = field.key === "remark" ? "span-2" : "";
  const hint = field.hint ? `<span class="hint">${esc(field.hint)}</span>` : "";
  return `<label class="field ${wide}"><span>${esc(field.label)}${required}</span>${control}${hint}</label>`;
}

function renderEntry() {
  const scope = currentScope();
  const editing = state.editingId
    ? `<span class="badge badge-warn">正在编辑 #${state.editingId}</span>`
    : "";

  $("#view-entry").innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">填写${esc(scope.tableName)}</h2>
            <p class="card-desc">日期、客户、方量为必填；金额按“配置 → 金额公式”实时计算。</p>
          </div>
          <div class="spacer"></div>
          <div class="segmented" id="scope-switch">
            ${state.meta.scopes
              .map(
                (item) =>
                  `<button type="button" data-scope="${item.key}" class="${
                    item.key === state.scope ? "is-active" : ""
                  }">${esc(item.tableName)}</button>`,
              )
              .join("")}
          </div>
        </div>

        <form id="entry-form" autocomplete="off">
          <div class="form-grid">
            ${scope.fields.map((field) => fieldHtml(field)).join("")}
            ${fieldHtml({
              key: "amount_override",
              label: "金额（选填）",
              type: "number",
              required: false,
              placeholder: "留空自动算",
              hint: "留空按公式计算，填写则以此为准",
            })}
          </div>

          <div class="live-bar" id="live-bar">
            <span class="live-item">方量 <span class="live-value" data-live="volume">—</span> 方</span>
            <span class="live-item">单价 <span class="live-value" data-live="price">—</span> 元/方</span>
            <span class="live-item">金额 <span class="live-value" data-live="amount">—</span> 元</span>
            <span class="live-note" data-live="note"></span>
          </div>

          <div class="form-actions">
            <button class="btn btn-primary" type="submit">${state.editingId ? "保存修改" : "保存记录"}</button>
            <button class="btn" type="button" id="reset-btn">清空</button>
            <span class="spacer"></span>
            ${editing}
            <span class="hint">时间：${esc(state.meta.today)}（Asia/Shanghai）</span>
          </div>
        </form>
      </div>

      <div class="card card-tight">
        <div class="card-head">
          <div>
            <h2 class="card-title">最近记录</h2>
            <p class="card-desc">${esc(scope.tableName)}最近 20 条，点“编辑”可载入上方表单修改</p>
          </div>
          <div class="spacer"></div>
          <button class="btn btn-sm" type="button" id="refresh-recent">刷新</button>
        </div>
        <div id="recent-wrap"><div class="empty">加载中…</div></div>
      </div>
    </div>
    ${datalistsHtml()}
  `;

  bindEntryEvents();
  updateLive();
  refreshRecent();
}

function bindEntryEvents() {
  $$("#scope-switch button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.scope === state.scope) return;
      state.scope = button.dataset.scope;
      state.editingId = null;
      renderEntry();
    });
  });

  $("#entry-form").addEventListener("input", scheduleLive);
  $("#entry-form").addEventListener("change", scheduleLive);
  $("#entry-form").addEventListener("submit", submitEntry);
  $("#reset-btn").addEventListener("click", () => {
    state.editingId = null;
    resetForm();
    toast("已清空表单");
  });
  $("#refresh-recent").addEventListener("click", refreshRecent);
}

function readEntryForm() {
  const scope = currentScope();
  const data = { scope: scope.key };
  for (const field of scope.fields) {
    const input = $(`#f-${field.key}`);
    const raw = input ? input.value : "";
    if (field.type === "number") {
      data[field.key] = raw.trim() === "" ? "" : raw;
    } else {
      data[field.key] = raw.trim();
    }
  }

  const overrideInput = $("#f-amount_override");
  data.amount_override = overrideInput ? overrideInput.value.trim() : "";
  return data;
}

function resetForm() {
  const scope = currentScope();
  for (const field of scope.fields) {
    const input = $(`#f-${field.key}`);
    if (!input) continue;
    input.value = field.type === "date" ? state.meta.today : "";
    input.classList.remove("is-invalid");
  }
  const amountInput = $("#f-amount_override");
  if (amountInput) amountInput.value = "";
  updateLive();
}

let liveTimer = null;
let liveToken = 0;
let lastFormulaInput = null;

function scheduleLive() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(updateLive, 240);
}

function setLive(name, text) {
  const node = $(`[data-live="${name}"]`);
  if (node) node.textContent = text;
}

async function updateLive() {
  const token = ++liveToken;
  const row = readEntryForm();
  const formulas = state.meta.formulas[state.scope];

  let volume = row.volume === "" ? null : Number(row.volume);
  if (volume !== null && !Number.isFinite(volume)) volume = null;

  let volumeNote = "";
  let volumeError = "";

  if (volume === null) {
    try {
      const result = await api("/api/evaluate", {
        method: "POST",
        body: { scope: state.scope, expression: formulas.volume_formula, ...row },
      });
      if (token !== liveToken) return;
      if (result.ok && Number(result.value) > 0) {
        volume = Number(result.value);
        volumeNote = "方量由公式计算";
      } else if (!result.ok) {
        volumeError = result.error;
      }
    } catch (error) {
      if (token !== liveToken) return;
      volumeError = error.message;
    }
  }

  let amount = null;
  let price = null;
  let priceMissing = false;
  let amountError = "";

  try {
    const result = await api("/api/evaluate", {
      method: "POST",
      body: { scope: state.scope, expression: formulas.amount_formula, ...row, volume: volume ?? 0 },
    });
    if (token !== liveToken) return;
    price = result.unitPrice;
    priceMissing = result.priceMissing;
    if (result.ok) amount = Number(result.value);
    else amountError = result.error;
  } catch (error) {
    if (token !== liveToken) return;
    amountError = error.message;
  }

  setLive("volume", volume === null ? "—" : fmt(volume, 3));
  setLive("price", price === null ? "—" : fmt(price));

  const overrideRaw = String(row.amount_override ?? "").trim();
  const manual = overrideRaw === "" ? null : Number(overrideRaw);
  const manualActive = manual !== null && Number.isFinite(manual) && manual >= 0;
  const effective = manualActive ? manual : amount;
  setLive("amount", effective === null ? "—" : fmt(effective));

  const note = $('[data-live="note"]');
  if (note) {
    let text = "";
    if (volumeError) text = `方量公式：${volumeError}`;
    else if (amountError) text = `金额公式：${amountError}`;
    else if (manualActive) text = `手动金额（公式值 ${amount === null ? "—" : fmt(amount)} 元）`;
    else if (priceMissing) text = "未匹配到单价，请到配置页设置";
    else if (volumeNote) text = volumeNote;
    note.textContent = text;
  }
}

async function submitEntry(event) {
  event.preventDefault();
  const row = readEntryForm();
  const payload = { ...row };
  if (payload.volume === "") delete payload.volume;
  if (payload.amount_override === "") delete payload.amount_override;

  const button = $('#entry-form button[type="submit"]');
  button.disabled = true;

  try {
    if (state.editingId) {
      await api(`/api/records/${state.editingId}`, { method: "PUT", body: payload });
      toast("已更新记录");
    } else {
      await api("/api/records", { method: "POST", body: payload });
      toast("已保存记录");
    }
    state.editingId = null;
    await rememberDicts(row);
    resetForm();
    renderEntry();
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function rememberDicts(row) {
  const scope = currentScope();
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

async function refreshRecent() {
  const wrap = $("#recent-wrap");
  if (!wrap) return;

  try {
    const data = await api(`/api/records?scope=${encodeURIComponent(state.scope)}&limit=20`);
    if (!data.rows.length) {
      wrap.innerHTML = `<div class="empty">还没有记录，先在上方填一条吧</div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>日期</th><th>客户名称</th><th>车型</th><th class="num">方量</th><th class="num">单价</th>
            <th class="num">金额</th><th>备注</th><th class="num">操作</th>
          </tr></thead>
          <tbody>
            ${data.rows
              .map(
                (row) => `
              <tr>
                <td>${esc(row.entry_date)}</td>
                <td class="strong">${esc(row.customer_name)}</td>
                <td>${esc(row.truck_model) || "—"}</td>
                <td class="num">${fmt(row.volume, 3)}</td>
                <td class="num">${fmt(row.unit_price)}</td>
                <td class="num strong">${fmt(row.amount)}${
                  row.amount_source === "manual" ? ' <span class="badge badge-warn">手动</span>' : ""
                }</td>
                <td class="wrap muted">${esc(row.remark) || "—"}</td>
                <td>
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
    `;

    $$("[data-edit]", wrap).forEach((button) =>
      button.addEventListener("click", () => startEdit(Number(button.dataset.edit), data.rows)),
    );
    $$("[data-delete]", wrap).forEach((button) =>
      button.addEventListener("click", () => deleteRecord(Number(button.dataset.delete), refreshRecent)),
    );
  } catch (error) {
    wrap.innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`;
  }
}

function startEdit(id, rows) {
  const row = (rows || []).find((item) => item.id === id);
  if (!row) return;

  state.scope = row.scope;
  state.editingId = id;
  renderEntry();

  const scope = currentScope();
  for (const field of scope.fields) {
    const input = $(`#f-${field.key}`);
    if (!input) continue;
    input.value = row[field.key] ?? "";
  }

  const amountInput = $("#f-amount_override");
  if (amountInput) {
    amountInput.value =
      row.amount_override === null || row.amount_override === undefined ? "" : row.amount_override;
  }

  updateLive();
  $("#entry-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
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

/* ---------------------------------------------------------------- 拍照录入页 */

function renderPhoto() {
  const ocr = state.meta.ocr || {};
  const photo = state.photo;
  const hasDrafts = photo.drafts.length > 0;

  $("#view-photo").innerHTML = `
    <div class="stack">
      ${
        ocr.enabled
          ? ""
          : `<div class="card card-tight"><div class="notice"><div class="notice-body">
               服务端还没有配置 <code>DASHSCOPE_API_KEY</code>，拍照识别暂时不可用。
             </div></div></div>`
      }
      <div class="card">
        <div class="card-head">
          <div>
            <h2 class="card-title">拍照入账</h2>
            <p class="card-desc">上传手写台账照片，AI 先识别成草稿，你核对修改后再入库——识别结果不会直接写库。</p>
          </div>
          <div class="spacer"></div>
          <span class="badge">${esc(ocr.model || "qwen3-vl-plus")}</span>
        </div>

        <div class="ocr-drop" id="ocr-drop">
          <input type="file" id="ocr-file" accept="image/*" capture="environment" hidden />
          <div class="ocr-drop-body">
            <button class="btn btn-primary" type="button" id="ocr-pick">选择 / 拍摄照片</button>
            <span class="hint">支持 JPG / PNG；也可以 <b>Ctrl+V 粘贴截图</b>，或把图片拖进来</span>
          </div>
          <div id="ocr-preview"></div>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" type="button" id="ocr-run" ${photo.dataUrl && ocr.enabled ? "" : "disabled"}>开始识别</button>
          ${hasDrafts ? '<button class="btn" type="button" id="ocr-again">重新识别</button>' : ""}
          <span class="hint" id="ocr-status"></span>
        </div>
      </div>

      <div class="card" id="ocr-result-card" ${hasDrafts ? "" : "hidden"}>
        <div class="card-head">
          <div>
            <h2 class="card-title">识别草稿</h2>
            <p class="card-desc">逐行核对：表、客户、方量、备注都能直接改；确认无误再入库</p>
          </div>
          <div class="spacer"></div>
          <label class="field" style="width:168px"><span>日期</span><input type="date" id="ocr-date" value="${esc(
            photo.date || state.meta.today,
          )}" /></label>
        </div>
        <div id="ocr-table"></div>
        <div class="form-actions">
          <button class="btn btn-primary" type="button" id="ocr-save">确认入库</button>
          <button class="btn" type="button" id="ocr-clear">清空</button>
          <span class="spacer"></span>
          <span class="hint">共 ${photo.drafts.length} 条</span>
        </div>
      </div>

      <div class="card card-tight">
        <div class="card-head">
          <div>
            <h2 class="card-title">照片存档</h2>
            <p class="card-desc">识别过的原图按日期归档，点缩略图看大图</p>
          </div>
          <div class="spacer"></div>
          <label class="field" style="width:168px"><span>日期</span><select id="archive-date"></select></label>
        </div>
        <div id="archive-grid" class="photo-grid"><div class="empty">加载中…</div></div>
      </div>
    </div>
    ${datalistsHtml()}
  `;

  bindPhotoEvents();
  renderPhotoPreview();
  renderDrafts();
  loadArchive();
}

function bindPhotoEvents() {
  $("#ocr-pick")?.addEventListener("click", () => $("#ocr-file")?.click());
  $("#ocr-file")?.addEventListener("change", handlePhotoFile);
  $("#ocr-run")?.addEventListener("click", runOcr);
  $("#ocr-again")?.addEventListener("click", runOcr);

  const drop = $("#ocr-drop");
  drop?.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop?.addEventListener("drop", async (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) await loadPhotoFile(file);
  });
  $("#ocr-save")?.addEventListener("click", saveDrafts);
  $("#ocr-clear")?.addEventListener("click", () => {
    state.photo = { dataUrl: "", date: "", drafts: [] };
    renderPhoto();
  });
  $("#ocr-date")?.addEventListener("change", (event) => {
    state.photo.date = event.target.value;
  });
}

function renderPhotoPreview() {
  const wrap = $("#ocr-preview");
  if (!wrap) return;
  wrap.innerHTML = state.photo.dataUrl
    ? `<img class="ocr-preview-img" alt="待识别照片" src="${state.photo.dataUrl}" />`
    : "";
}

async function handlePhotoFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await loadPhotoFile(file);
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
  if (!state.meta) return;
  const file = imageFromClipboard(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  if (state.tab !== "photo") switchTab("photo");
  await loadPhotoFile(file);
});

async function loadPhotoFile(file) {
  if (!String(file?.type || "").startsWith("image/")) {
    toast("请上传图片文件", true);
    return;
  }
  if (state.photo.drafts.length && !window.confirm("当前有未入库的草稿，换成新图片会清空，继续？")) {
    return;
  }

  try {
    const status = $("#ocr-status");
    if (status) status.textContent = "正在处理图片…";
    state.photo.dataUrl = await compressImage(file);
    state.photo.drafts = [];
    state.photo.date = "";
    renderPhoto();
    const next = $("#ocr-status");
    if (next) next.textContent = "图片已就绪，点「开始识别」";
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

async function runOcr() {
  if (!state.photo.dataUrl) return;

  const status = $("#ocr-status");
  const button = $("#ocr-run");
  if (button) button.disabled = true;
  if (status) status.textContent = "识别中，通常 15–40 秒…";

  try {
    const result = await api("/api/ocr", { method: "POST", body: { image: state.photo.dataUrl } });
    state.photo.date = result.date || state.meta.today;
    state.photo.drafts = result.entries || [];
    renderPhoto();
    toast(`识别到 ${state.photo.drafts.length} 条，请核对`);
  } catch (error) {
    toast(error.message, true);
    if (status) status.textContent = "";
    if (button) button.disabled = false;
  }
}

function renderDrafts() {
  const wrap = $("#ocr-table");
  if (!wrap) return;

  const drafts = state.photo.drafts;
  if (!drafts.length) {
    wrap.innerHTML = `<div class="empty">还没有识别结果</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>表</th><th>客户名称</th><th>车型</th><th class="num">方量</th><th>备注</th>
          <th>原文</th><th>置信</th><th class="num">操作</th>
        </tr></thead>
        <tbody>
          ${drafts
            .map(
              (draft, index) => `
            <tr>
              <td>
                <select data-idx="${index}" data-field="table">
                  <option value="pump"${draft.table === "pump" ? " selected" : ""}>泵车</option>
                  <option value="mixer"${draft.table === "mixer" ? " selected" : ""}>搅拌车</option>
                </select>
              </td>
              <td><input type="text" data-idx="${index}" data-field="customer" value="${esc(draft.customer)}" /></td>
              <td><input type="text" list="dl-truck_model" data-idx="${index}" data-field="truck_model" value="${esc(
                draft.truck_model || "",
              )}" placeholder="如 二号" /></td>
              <td><input type="number" step="0.001" min="0" data-idx="${index}" data-field="volume" value="${esc(
                draft.volume,
              )}" /></td>
              <td><textarea rows="2" data-idx="${index}" data-field="note">${esc(draft.note)}</textarea></td>
              <td class="wrap muted">${esc(draft.raw) || "—"}</td>
              <td>${confidenceBadge(draft)}</td>
              <td><div class="row-actions"><button class="btn btn-sm btn-danger" type="button" data-del="${index}">删除</button></div></td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  $$("[data-idx]", wrap).forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.idx);
      const field = input.dataset.field;
      state.photo.drafts[index][field] = field === "volume" ? Number(input.value) : input.value;
    });
    input.addEventListener("change", () => {
      const index = Number(input.dataset.idx);
      const field = input.dataset.field;
      state.photo.drafts[index][field] = field === "volume" ? Number(input.value) : input.value;
    });
  });

  $$("[data-del]", wrap).forEach((button) =>
    button.addEventListener("click", () => {
      state.photo.drafts.splice(Number(button.dataset.del), 1);
      renderDrafts();
      const card = $("#ocr-result-card");
      if (card && !state.photo.drafts.length) card.hidden = true;
    }),
  );
}

async function loadArchive() {
  const grid = $("#archive-grid");
  if (!grid) return;

  try {
    const data = await api("/api/photos");
    state.photoArchive.dates = data.dates || [];

    if (!state.photoArchive.dates.length) {
      grid.innerHTML = `<div class="empty">还没有存档照片，识别一次就会自动归档</div>`;
      return;
    }

    if (!state.photoArchive.date) state.photoArchive.date = state.photoArchive.dates[0].date;

    const select = $("#archive-date");
    if (select) {
      select.innerHTML = state.photoArchive.dates
        .map(
          (item) =>
            `<option value="${esc(item.date)}"${item.date === state.photoArchive.date ? " selected" : ""}>${esc(
              item.date,
            )}（${item.count}）</option>`,
        )
        .join("");
      select.onchange = () => {
        state.photoArchive.date = select.value;
        loadArchivePhotos();
      };
    }

    await loadArchivePhotos();
  } catch (error) {
    grid.innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`;
  }
}

async function loadArchivePhotos() {
  const grid = $("#archive-grid");
  if (!grid) return;

  const date = state.photoArchive.date;
  try {
    const data = await api(`/api/photos?date=${encodeURIComponent(date)}`);
    state.photoArchive.photos = data.photos || [];

    grid.innerHTML = state.photoArchive.photos.length
      ? state.photoArchive.photos
          .map((photo) => {
            const url = `/api/photos/file?date=${encodeURIComponent(date)}&name=${encodeURIComponent(photo.name)}`;
            return `<a class="photo-thumb" href="${url}" target="_blank" rel="noreferrer" title="${esc(photo.name)}">
                      <img src="${url}" alt="台账照片" loading="lazy" />
                    </a>`;
          })
          .join("")
      : `<div class="empty">这一天还没有照片</div>`;
  } catch (error) {
    grid.innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`;
  }
}

function confidenceBadge(draft) {
  if (draft.confidence === null || draft.confidence === undefined) return `<span class="badge">—</span>`;
  const percent = Math.round(draft.confidence * 100);
  const tone = draft.confidence >= 0.9 ? "badge-ok" : draft.confidence >= 0.7 ? "badge-warn" : "badge-danger";
  const title = draft.uncertain?.length ? ` title="不确定：${esc(draft.uncertain.join("、"))}"` : "";
  return `<span class="badge ${tone}"${title}>${percent}%</span>`;
}

async function saveDrafts() {
  const date = $("#ocr-date")?.value || state.meta.today;
  const drafts = state.photo.drafts.filter((draft) => draft.customer.trim() && Number(draft.volume) > 0);
  const skipped = state.photo.drafts.length - drafts.length;
  if (!drafts.length) {
    toast("没有可入库的行（客户和方量都要有值）", true);
    return;
  }

  const missingModel = drafts.filter((draft) => draft.table === "pump" && !String(draft.truck_model || "").trim());
  if (missingModel.length) {
    toast(`有 ${missingModel.length} 行泵车没填车型（必填），补一下再入库`, true);
    return;
  }

  const button = $("#ocr-save");
  if (button) button.disabled = true;

  let saved = 0;
  const errors = [];
  for (const draft of drafts) {
    try {
      await api("/api/records", {
        method: "POST",
        body: {
          scope: draft.table,
          entry_date: date,
          customer_name: draft.customer.trim(),
          truck_model: String(draft.truck_model || "").trim(),
          volume: Number(draft.volume),
          remark: draft.note.trim(),
        },
      });
      saved += 1;
    } catch (error) {
      errors.push(`${draft.customer}：${error.message}`);
    }
  }

  if (button) button.disabled = false;

  if (errors.length) {
    toast(`已入库 ${saved} 条，失败 ${errors.length} 条：${errors[0]}`, true);
    return;
  }

  toast(`已入库 ${saved} 条${skipped ? `（跳过 ${skipped} 行缺客户/方量）` : ""}`);
  state.photo = { dataUrl: "", date: "", drafts: [] };
  renderPhoto();
}

/* ---------------------------------------------------------------- 看板 */

function defaultFilters() {
  const today = state.meta.today;
  return {
    scope: "all",
    from: `${today.slice(0, 8)}01`,
    to: today,
    customer: "",
    model: "",
    q: "",
    quick: "month",
  };
}

function applyQuick(quick) {
  const today = state.meta.today;
  const set = (from, to) => {
    state.filters.from = from;
    state.filters.to = to;
  };

  if (quick === "today") set(today, today);
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
    applyQuick("month");
    state.boardInitialized = true;
  }
  const dicts = state.meta.dicts;
  const options = (kind, selected) =>
    [`<option value="">全部</option>`]
      .concat((dicts[kind] || []).map((item) => `<option value="${esc(item.label)}"${item.label === selected ? " selected" : ""}>${esc(item.label)}</option>`))
      .join("");

  $("#view-board").innerHTML = `
    <div class="stack">
      <div class="card card-tight">
        <form id="filter-form">
          <div class="filter-bar">
            <div class="quick-dates" id="quick-dates">
              ${[
                ["today", "今天"],
                ["yesterday", "昨天"],
                ["week", "近7天"],
                ["month", "本月"],
                ["lastMonth", "上月"],
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
            <label class="field"><span>开始日期</span><input type="date" id="f-from" value="${esc(state.filters.from)}" /></label>
            <label class="field"><span>结束日期</span><input type="date" id="f-to" value="${esc(state.filters.to)}" /></label>
            <label class="field"><span>表</span>
              <select id="f-scope">
                <option value="all"${state.filters.scope === "all" ? " selected" : ""}>全部</option>
                ${state.meta.scopes
                  .map((scope) => `<option value="${scope.key}"${state.filters.scope === scope.key ? " selected" : ""}>${esc(scope.tableName)}</option>`)
                  .join("")}
              </select>
            </label>
            <label class="field"><span>客户名称</span><select id="f-customer">${options("customer", state.filters.customer)}</select></label>
            <label class="field"><span>车型</span><select id="f-model">${options("truck_model", state.filters.model)}</select></label>
            <label class="field grow"><span>搜索</span><input type="search" id="f-q" value="${esc(state.filters.q)}" placeholder="客户 / 备注 / 地点" /></label>
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

  $("#quick-dates").addEventListener("click", (event) => {
    const key = event.target.closest("[data-quick]")?.dataset.quick;
    if (!key) return;
    applyQuick(key);
    renderBoard();
  });

  $("#filter-form").addEventListener("submit", (event) => {
    event.preventDefault();
    readFilters();
    state.filters.quick = "";
    loadDashboard();
  });

  $("#export-btn").addEventListener("click", () => {
    readFilters();
    const params = filterParams();
    window.location.href = `/api/export.csv?${params}`;
  });

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
  if (grid) grid.innerHTML = "";

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
  const pump = data.scopes?.pump || { count: 0, volume: 0, amount: 0, avgPrice: 0 };
  const mixer = data.scopes?.mixer || { count: 0, volume: 0, amount: 0, avgPrice: 0 };

  $("#kpi-grid").innerHTML = `
    <div class="kpi-group is-accent">
      <div class="kpi-group-head">总计</div>
      <div class="kpi-row"><span>总方量</span><b>${fmt(kpi.volume, 3)}<small>方</small></b></div>
      <div class="kpi-row"><span>总金额</span><b>${fmt(kpi.amount)}<small>元</small></b></div>
    </div>
    <div class="kpi-group">
      <div class="kpi-group-head">泵车</div>
      <div class="kpi-row"><span>方量</span><b>${fmt(pump.volume, 3)}<small>方</small></b></div>
      <div class="kpi-row"><span>记录数</span><b>${pump.count}<small>条</small></b></div>
      <div class="kpi-row"><span>金额</span><b>${fmt(pump.amount)}<small>元</small></b></div>
    </div>
    <div class="kpi-group">
      <div class="kpi-group-head">搅拌车</div>
      <div class="kpi-row"><span>方量</span><b>${fmt(mixer.volume, 3)}<small>方</small></b></div>
      <div class="kpi-row"><span>金额</span><b>${fmt(mixer.amount)}<small>元</small></b></div>
    </div>
  `;

  const notices = [];
  if (!data.priceConfigured) {
    notices.push(`还没有配置单价，金额会全部是 0。请到“配置 → 单价配置”填写，或设置一条默认单价。`);
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

  const groupTabs = [
    ["customer", "按客户"],
    ["model", "按车型"],
    ["date", "按日期"],
    ["scope", "按表"],
  ];

  $("#board-body").innerHTML = `
    ${notices
      .map(
        (text) => `<div class="card card-tight"><div class="notice"><div class="notice-body">${esc(text)}</div></div></div>`,
      )
      .join("")}
    <div class="card">
      <div class="card-head">
        <div><h2 class="card-title">汇总</h2><p class="card-desc">按不同维度汇总方量与金额</p></div>
        <div class="spacer"></div>
        <div class="segmented" id="group-tabs">
          ${groupTabs
            .map(
              ([key, label]) =>
                `<button type="button" data-group="${key}" class="${state.groupBy === key ? "is-active" : ""}">${label}</button>`,
            )
            .join("")}
        </div>
      </div>
      <div id="group-table"></div>
    </div>

    <div class="card card-tight">
      <div class="card-head">
        <div><h2 class="card-title">明细</h2><p class="card-desc">共 ${data.rows.length} 条，点击“编辑”可载入录入页修改</p></div>
      </div>
      <div id="detail-table"></div>
      <div class="pagination" id="pagination"></div>
    </div>
  `;

  $("#group-tabs").addEventListener("click", (event) => {
    const key = event.target.closest("[data-group]")?.dataset.group;
    if (!key) return;
    state.groupBy = key;
    $$("#group-tabs button").forEach((button) => button.classList.toggle("is-active", button.dataset.group === key));
    renderGroupTable();
  });

  renderGroupTable();
  renderDetailTable();
}

function renderGroupTable() {
  const data = state.dashboard;
  const rows = data.groups[state.groupBy] || [];
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0) || 1;

  $("#group-table").innerHTML = rows.length
    ? `<div class="table-wrap">
        <table class="table">
          <thead><tr><th>名称</th><th class="num">记录数</th><th class="num">方量</th><th class="num">金额</th><th>金额占比</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (row) => `
              <tr>
                <td class="strong">${esc(row.key) || "—"}</td>
                <td class="num">${row.count}</td>
                <td class="num">${fmt(row.volume, 3)}</td>
                <td class="num strong">${fmt(row.amount)}</td>
                <td><div class="bar"><span style="width:${Math.max(2, (row.amount / totalAmount) * 100).toFixed(1)}%"></span></div></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="empty">当前筛选条件下没有数据</div>`;
}

function renderDetailTable() {
  const data = state.dashboard;
  const rows = data.rows;
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const slice = rows.slice(start, start + state.pageSize);

  $("#detail-table").innerHTML = slice.length
    ? `<div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>日期</th><th>表</th><th>车型</th><th>客户名称</th><th class="num">方量</th>
            <th class="num">单价</th><th class="num">金额</th><th>备注</th><th class="num">操作</th>
          </tr></thead>
          <tbody>
            ${slice
              .map(
                (row) => `
              <tr>
                <td>${esc(row.entry_date)}</td>
                <td><span class="badge badge-${row.scope === "pump" ? "pump" : "mixer"}">${esc(row.scope_label)}</span></td>
                <td>${esc(row.truck_model) || "—"}</td>
                <td class="strong">${esc(row.customer_name)}</td>
                <td class="num">${fmt(row.volume, 3)}</td>
                <td class="num">${fmt(row.unit_price)}</td>
                <td class="num strong">${
                  row.amount_error
                    ? '<span class="badge badge-danger">公式错误</span>'
                    : fmt(row.amount)
                }${row.amount_source === "manual" ? ' <span class="badge badge-warn">手动</span>' : ""}</td>
                <td class="wrap muted">${esc(row.remark) || "—"}</td>
                <td>
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
      </div>`
    : `<div class="empty">当前筛选条件下没有数据</div>`;

  const pagination = $("#pagination");
  if (pagination) {
    pagination.innerHTML =
      rows.length === 0
        ? ""
        : `<span>第 ${state.page} / ${pages} 页 · 共 ${rows.length} 条</span>
           <button class="btn btn-sm" type="button" data-page="prev" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
           <button class="btn btn-sm" type="button" data-page="next" ${state.page >= pages ? "disabled" : ""}>下一页</button>`;

    $$("[data-page]").forEach((button) =>
      button.addEventListener("click", () => {
        state.page += button.dataset.page === "next" ? 1 : -1;
        renderDetailTable();
      }),
    );
  }

  $$("#detail-table [data-edit]").forEach((button) =>
    button.addEventListener("click", () => {
      const id = Number(button.dataset.edit);
      switchTab("entry");
      startEdit(id, rows);
    }),
  );

  $$("#detail-table [data-delete]").forEach((button) =>
    button.addEventListener("click", () =>
      deleteRecord(Number(button.dataset.delete), async () => {
        await loadDashboard();
      }),
    ),
  );
}

/* ---------------------------------------------------------------- 配置页 */

function renderConfig() {
  const meta = state.meta;

  $("#view-config").innerHTML = `
    <div class="stack">
      ${
        !meta.priceConfigured
          ? `<div class="card card-tight"><div class="notice"><div class="notice-body">
              当前所有单价都是 0，看板金额会显示为 0。请在下方“单价配置”里设置默认单价（客户、车型都填 <code>*</code>），
              或按客户 / 车型分别设置。
             </div></div></div>`
          : ""
      }

      <div class="card">
        <div class="card-head">
          <div><h2 class="card-title">名称配置</h2><p class="card-desc">客户名称、车型都是可维护的选项，录入时也可直接输入新值并自动收录</p></div>
        </div>
        <div class="config-grid">
          ${Object.keys(meta.dictKinds)
            .map(
              (kind) => `
            <div>
              <h3 class="section-title">${esc(meta.dictKinds[kind]?.label || kind)}</h3>
              <div class="inline-add">
                <input type="text" id="new-${kind}" placeholder="新增${esc(meta.dictKinds[kind]?.label || "")}" />
                <button class="btn btn-sm" type="button" data-add-dict="${kind}">添加</button>
              </div>
              <div class="dict-list">
                ${
                  (meta.dicts[kind] || [])
                    .map(
                      (item) => `
                  <div class="dict-item">
                    <span class="grow">${esc(item.label)}</span>
                    <button class="btn btn-sm btn-ghost" type="button" data-del-dict="${item.id}" title="删除">✕</button>
                  </div>`,
                    )
                    .join("") || `<div class="empty">还没有选项</div>`
                }
              </div>
            </div>`,
            )
            .join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2 class="card-title">单价配置</h2><p class="card-desc">匹配顺序：客户+车型 → 客户默认 → 车型默认 → 全局默认（<code>*</code>）</p></div>
        </div>
        <form id="price-form">
          <div class="form-grid">
            <label class="field"><span>表</span>
              <select id="p-scope">
                ${meta.scopes.map((scope) => `<option value="${scope.key}">${esc(scope.tableName)}</option>`).join("")}
              </select>
            </label>
            <label class="field"><span>客户名称</span>
              <input id="p-customer" type="text" list="dl-customer" placeholder="* = 任意客户" value="*" />
            </label>
            <label class="field"><span>车型</span>
              <input id="p-model" type="text" list="dl-truck_model" placeholder="* = 任意车型" value="*" />
            </label>
            <label class="field"><span>单价（元/方）</span><input id="p-price" type="number" step="0.01" min="0" placeholder="0.00" /></label>
            <label class="field span-2"><span>备注</span><input id="p-note" type="text" placeholder="例如：2026 年 11 月起执行" /></label>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">保存单价</button>
          </div>
        </form>
        <div id="price-table" style="margin-top:14px"></div>
        ${datalistsHtml()}
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2 class="card-title">公式配置</h2><p class="card-desc">变量就是两张表的列名，可点下方“变量”插入；不使用 eval，语法安全</p></div>
        </div>
        <div class="split" id="formula-editors">
          ${meta.scopes.map((scope) => formulaEditorHtml(scope)).join("")}
        </div>
      </div>
    </div>
  `;

  bindConfigEvents();
  renderPriceTable();
}

function formulaEditorHtml(scope) {
  const formula = state.meta.formulas[scope.key] || { volume_formula: "", amount_formula: "", amount_decimals: 2 };

  return `
    <div class="card card-tight" data-formula-scope="${scope.key}">
      <h3 class="section-title">${esc(scope.tableName)}</h3>
      <div class="formula-box">
        <div class="formula-row">
          <span>方量公式</span>
          <input class="formula-input" data-formula="volume_formula" value="${esc(formula.volume_formula)}" />
        </div>
        <div class="formula-row">
          <span>金额公式</span>
          <input class="formula-input" data-formula="amount_formula" value="${esc(formula.amount_formula)}" />
        </div>
        <div class="formula-row">
          <span>金额小数位</span>
          <select data-formula="amount_decimals">
            ${[0, 1, 2, 3, 4]
              .map((n) => `<option value="${n}"${Number(formula.amount_decimals) === n ? " selected" : ""}>${n} 位</option>`)
              .join("")}
          </select>
        </div>
        <div class="vars" data-vars="${scope.key}">
          ${state.meta.variables
            .map((name) => `<button class="var-chip" type="button" data-var="${esc(name)}">${esc(name)}</button>`)
            .join("")}
        </div>
        <div class="func-list">
          ${state.meta.functions
            .map((fn) => `<div><code>${esc(fn.syntax)}</code> — ${esc(fn.description)}</div>`)
            .join("")}
        </div>
        <div class="preview" data-preview="${scope.key}">点击“试算”查看结果</div>
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" type="button" data-save-formula="${scope.key}">保存公式</button>
          <button class="btn btn-sm" type="button" data-test-formula="${scope.key}">试算</button>
        </div>
      </div>
    </div>
  `;
}

function bindConfigEvents() {
  $$("[data-add-dict]").forEach((button) =>
    button.addEventListener("click", async () => {
      const kind = button.dataset.addDict;
      const input = $(`#new-${kind}`);
      const label = (input?.value || "").trim();
      if (!label) return toast("请输入名称", true);
      try {
        await api("/api/dicts", { method: "POST", body: { kind, scope: "both", label } });
        toast("已添加");
        state.meta = await api("/api/meta");
        renderConfig();
      } catch (error) {
        toast(error.message, true);
      }
    }),
  );

  $$("[data-del-dict]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!window.confirm("删除这个选项？已录入的记录不受影响。")) return;
      try {
        await api(`/api/dicts/${button.dataset.delDict}`, { method: "DELETE" });
        toast("已删除");
        state.meta = await api("/api/meta");
        renderConfig();
      } catch (error) {
        toast(error.message, true);
      }
    }),
  );

  $("#price-form").addEventListener("submit", async (event) => {
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
      renderConfig();
    } catch (error) {
      toast(error.message, true);
    }
  });

  $$("[data-var]").forEach((button) =>
    button.addEventListener("click", () => {
      const editor = button.closest("[data-formula-scope]");
      const fallback = editor.querySelector('[data-formula="amount_formula"]');
      const focused = lastFormulaInput && editor.contains(lastFormulaInput) ? lastFormulaInput : fallback;
      insertAtCursor(focused, button.dataset.var);
    }),
  );

  $$("#formula-editors .formula-input").forEach((input) =>
    input.addEventListener("focus", () => {
      lastFormulaInput = input;
    }),
  );

  $$("[data-save-formula]").forEach((button) =>
    button.addEventListener("click", async () => {
      const scopeKey = button.dataset.saveFormula;
      const editor = button.closest("[data-formula-scope]");
      const body = {
        scope: scopeKey,
        volume_formula: editor.querySelector('[data-formula="volume_formula"]').value.trim(),
        amount_formula: editor.querySelector('[data-formula="amount_formula"]').value.trim(),
        amount_decimals: Number(editor.querySelector('[data-formula="amount_decimals"]').value),
      };
      try {
        await api("/api/formulas", { method: "PUT", body });
        toast("公式已保存");
        state.meta = await api("/api/meta");
      } catch (error) {
        toast(error.message, true);
      }
    }),
  );

  $$("[data-test-formula]").forEach((button) =>
    button.addEventListener("click", () => testFormula(button.dataset.testFormula)),
  );

  $$("[data-preview]").forEach((node) => {
    if (node.dataset.preview) node.dataset.ready = "1";
  });
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  input.focus();
  input.selectionStart = input.selectionEnd = start + text.length;
}

async function testFormula(scopeKey) {
  const editor = $(`[data-formula-scope="${scopeKey}"]`);
  const preview = $(`[data-preview="${scopeKey}"]`);
  const volumeExpression = editor.querySelector('[data-formula="volume_formula"]').value.trim();
  const amountExpression = editor.querySelector('[data-formula="amount_formula"]').value.trim();

  const dicts = state.meta.dicts;
  const sample = {
    entry_date: state.meta.today,
    truck_model: (dicts.truck_model[0] || {}).label || "",
    customer_name: (dicts.customer[0] || {}).label || "",
    remark: "12*2+11",
    volume: "",
  };

  preview.textContent = "试算中…";
  try {
    const volumeResult = await api("/api/evaluate", {
      method: "POST",
      body: { scope: scopeKey, expression: volumeExpression, ...sample },
    });
    const volume = volumeResult.ok ? Number(volumeResult.value) : 0;

    const amountResult = await api("/api/evaluate", {
      method: "POST",
      body: { scope: scopeKey, expression: amountExpression, ...sample, volume },
    });

    preview.innerHTML = `
      <span>方量：${volumeResult.ok ? `<span class="ok">${fmt(volumeResult.value, 3)}</span>` : `<span class="bad">${esc(volumeResult.error)}</span>`}</span>
      <span>单价：${fmt(amountResult.unitPrice)} 元/方</span>
      <span>金额：${amountResult.ok ? `<span class="ok">${fmt(amountResult.value)} 元</span>` : `<span class="bad">${esc(amountResult.error)}</span>`}</span>
      <span class="muted">（示例：客户 ${esc(sample.customer_name)}，车型 ${esc(sample.truck_model)}，备注 12*2+11）</span>
    `;
  } catch (error) {
    preview.innerHTML = `<span class="bad">${esc(error.message)}</span>`;
  }
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

  $$("[data-del-price]").forEach((button) =>
    button.addEventListener("click", async () => {
      if (!window.confirm("删除这条单价？")) return;
      try {
        await api(`/api/prices/${button.dataset.delPrice}`, { method: "DELETE" });
        toast("已删除");
        state.meta = await api("/api/meta");
        renderConfig();
      } catch (error) {
        toast(error.message, true);
      }
    }),
  );
}

/* ---------------------------------------------------------------- 启动 */

boot().catch((error) => {
  console.error(error);
  toast(error.message || "初始化失败", true);
});
