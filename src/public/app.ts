interface OptionSets {
  pumpTruck: {
    truckModel: string[];
    customerName: string[];
  };
  mixerTruck: {
    customerName: string[];
    drivers: string[];
  };
}

interface ReportResponse {
  date: string;
  summary: {
    pumpTruckCount: number;
    mixerTruckCount: number;
    pumpTruckVolume: number;
    mixerTruckVolume: number;
    totalVolume: number;
  };
  pumpTruck: Array<{
    customerName: string;
    truckModel: string;
    volume: number;
    location: string;
  }>;
  mixerTruck: Array<{
    customerName: string;
    volume: number;
    remark: string;
    drivers: string[];
  }>;
  text: string;
}

const pumpForm = requiredElement<HTMLFormElement>("#pumpForm");
const mixerForm = requiredElement<HTMLFormElement>("#mixerForm");
const toast = requiredElement<HTMLDivElement>("#toast");
const reportDate = requiredElement<HTMLInputElement>("#reportDate");
const refreshReportButton = requiredElement<HTMLButtonElement>("#refreshReport");
const reportText = requiredElement<HTMLPreElement>("#reportText");
const pumpReportDetails = requiredElement<HTMLTableSectionElement>("#pumpReportDetails");
const mixerReportDetails = requiredElement<HTMLTableSectionElement>("#mixerReportDetails");
const mixerRemarkRows = requiredElement<HTMLDivElement>("#mixerRemarkRows");
const mixerRemarkRowTemplate = requiredElement<HTMLTemplateElement>("#mixerRemarkRowTemplate");
const addMixerRemarkRowButton = requiredElement<HTMLButtonElement>("#addMixerRemarkRow");
const mixerVolume = requiredElement<HTMLInputElement>("#mixerVolume");
const mixerDrivers = requiredElement<HTMLInputElement>("#mixerDrivers");
const strokeCollator = new Intl.Collator("zh-Hans-CN-u-co-stroke");
const fallbackCollator = new Intl.Collator("zh-Hans-CN");

const today = new Date();
const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
const defaultDate = toDateInputValue(today);
const defaultReportDate = toDateInputValue(yesterday);

for (const input of document.querySelectorAll<HTMLInputElement>('input[type="date"]')) {
  input.value = input.id === "reportDate" ? defaultReportDate : defaultDate;
}

for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab || "reportPanel"));
}

pumpForm.addEventListener("submit", submitPumpTruck);
mixerForm.addEventListener("submit", submitMixerTruck);
mixerForm.addEventListener("input", updateMixerSummary);
mixerRemarkRows.addEventListener("click", removeMixerRemarkRow);
addMixerRemarkRowButton.addEventListener("click", () => addMixerRemarkRow());
reportDate.addEventListener("change", () => void loadReport());
refreshReportButton.addEventListener("click", refreshReportCache);

addMixerRemarkRow(false);

await Promise.all([loadReport(), loadOptions()]);

async function loadOptions(): Promise<void> {
  try {
    const options = await request<OptionSets>("/api/options");
    setDatalist("#pumpTruckModelOptions", options.pumpTruck.truckModel);
    setDatalist("#pumpCustomerOptions", options.pumpTruck.customerName);
    setDatalist("#mixerCustomerOptions", options.mixerTruck.customerName);
    setDatalist("#driverOptions", options.mixerTruck.drivers);
  } catch (error) {
    showToast(`读取下拉选项失败：${messageFromError(error)}`);
  }
}

async function submitPumpTruck(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = new FormData(pumpForm);
  const payload = {
    date: stringValue(form.get("date")),
    truckModel: stringValue(form.get("truckModel")),
    customerName: stringValue(form.get("customerName")),
    volume: Number(form.get("volume")),
    location: stringValue(form.get("location")),
    addMissingOptions: true,
  };

  await submitRecord("/api/records/pump-truck", payload, pumpForm, "泵车记录已提交");
}

async function submitMixerTruck(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = new FormData(mixerForm);
  const details = readMixerDetails(true);
  if (!details) return;
  const payload = {
    date: stringValue(form.get("date")),
    customerName: stringValue(form.get("customerName")),
    volume: details.totalVolume,
    remark: details.remark,
    drivers: details.drivers,
    addMissingOptions: true,
  };

  await submitRecord("/api/records/mixer-truck", payload, mixerForm, "搅拌车记录已提交", resetMixerForm);
}

async function submitRecord(
  path: string,
  payload: unknown,
  form: HTMLFormElement,
  message: string,
  resetter: () => void = () => resetFormForNextEntry(form),
): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const result = await request<{ addedOptions?: string[] }>(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const added = result.addedOptions?.length ? `，新增选项：${result.addedOptions.join("、")}` : "";
    showToast(`${message}${added}`);
    resetter();
    await Promise.all([loadReport(), loadOptions()]);
  } catch (error) {
    showToast(messageFromError(error));
  } finally {
    if (button) button.disabled = false;
  }
}

interface MixerDetail {
  driver: string;
  expression: string;
  volume: number;
}

function addMixerRemarkRow(focus = true): void {
  const fragment = mixerRemarkRowTemplate.content.cloneNode(true);
  mixerRemarkRows.append(fragment);
  const addedRow = mixerRemarkRows.lastElementChild;
  if (focus) addedRow?.querySelector<HTMLInputElement>(".mixer-driver")?.focus();
  updateMixerSummary();
}

function removeMixerRemarkRow(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.classList.contains("remove-detail-button")) return;
  target.closest(".mixer-remark-row")?.remove();
  if (!mixerRemarkRows.children.length) addMixerRemarkRow();
  updateMixerSummary();
}

function updateMixerSummary(): void {
  const details = readMixerDetails(false);
  mixerVolume.value = details ? `${formatVolume(details.totalVolume)} 方` : "—";
  mixerDrivers.value = details?.drivers.length ? details.drivers.join("、") : "未填写";
}

function readMixerDetails(showErrors: boolean): { remark: string; drivers: string[]; totalVolume: number } | null {
  const details: MixerDetail[] = [];
  let valid = true;

  for (const row of mixerRemarkRows.querySelectorAll<HTMLElement>(".mixer-remark-row")) {
    const driverInput = requiredChild<HTMLInputElement>(row, ".mixer-driver");
    const expressionInput = requiredChild<HTMLInputElement>(row, ".mixer-expression");
    const errorElement = requiredChild<HTMLParagraphElement>(row, ".expression-error");
    const driver = driverInput.value.trim();
    const expressionResult = evaluateVolumeExpression(expressionInput.value);
    const rowIsBlank = !driver && !expressionInput.value.trim();
    const error = rowIsBlank
      ? "请填写驾驶员和每车方量"
      : !driver
        ? "请填写驾驶员"
        : expressionResult.error;

    errorElement.textContent = showErrors && error ? error : "";
    errorElement.classList.toggle("show", Boolean(showErrors && error));
    if (error) {
      valid = false;
      continue;
    }

    details.push({
      driver,
      expression: expressionResult.normalized,
      volume: expressionResult.value,
    });
  }

  if (!valid || !details.length) {
    if (showErrors) showToast("请检查驾驶员运输明细");
    return null;
  }

  return {
    remark: details.map((detail) => `${detail.driver}：${detail.expression}`).join("\n"),
    drivers: uniqueInInputOrder(details.map((detail) => detail.driver)),
    totalVolume: roundVolume(details.reduce((total, detail) => total + detail.volume, 0)),
  };
}

function evaluateVolumeExpression(input: string): { value: number; normalized: string; error: string } {
  const normalized = input.trim().replaceAll("＋", "+").replace(/[xX*]/g, "×").replaceAll(/\s/g, "");
  if (!normalized) return { value: 0, normalized, error: "请填写每车方量" };
  if (!/^\d+(?:\.\d+)?(?:[+×]\d+(?:\.\d+)?)*$/.test(normalized)) {
    return { value: 0, normalized, error: "方量只能使用数字、加号和乘号" };
  }

  const result = normalized.split("+").reduce((sum, product) => {
    return sum + product.split("×").reduce((result, factor) => result * Number(factor), 1);
  }, 0);
  if (!Number.isFinite(result) || result <= 0) {
    return { value: 0, normalized, error: "计算后的方量必须大于 0" };
  }
  return { value: roundVolume(result), normalized, error: "" };
}

function resetMixerForm(): void {
  mixerForm.reset();
  mixerRemarkRows.replaceChildren();
  addMixerRemarkRow(false);
  const dateInput = mixerForm.querySelector<HTMLInputElement>('input[type="date"]');
  if (dateInput) dateInput.value = defaultDate;
}

async function refreshReportCache(): Promise<void> {
  refreshReportButton.disabled = true;
  const originalText = refreshReportButton.textContent;
  refreshReportButton.textContent = "刷新中…";
  const refreshed = await loadReport(true);
  if (refreshed) showToast("报表缓存已强制刷新");
  refreshReportButton.disabled = false;
  refreshReportButton.textContent = originalText;
}

async function loadReport(forceRefresh = false): Promise<boolean> {
  try {
    const params = new URLSearchParams();
    if (reportDate.value) params.set("date", reportDate.value);
    if (forceRefresh) params.set("refresh", "1");
    const query = params.toString();
    const report = await request<ReportResponse>(`/api/report/yesterday${query ? `?${query}` : ""}`);
    renderReport(report);
    return true;
  } catch (error) {
    reportText.textContent = messageFromError(error);
    pumpReportDetails.innerHTML = emptyRow(4);
    mixerReportDetails.innerHTML = emptyRow(4);
    return false;
  }
}

function renderReport(report: ReportResponse): void {
  reportText.textContent = report.text;

  pumpReportDetails.innerHTML = report.pumpTruck.length
    ? report.pumpTruck.map((item) => `<tr><td>${escapeHtml(item.customerName)}</td><td>${escapeHtml(item.truckModel)}</td><td>${escapeHtml(formatVolume(item.volume))} 方</td><td>${escapeHtml(item.location)}</td></tr>`).join("")
    : emptyRow(4);

  mixerReportDetails.innerHTML = report.mixerTruck.length
    ? report.mixerTruck.map((item) => `<tr><td>${escapeHtml(item.customerName)}</td><td>${escapeHtml(formatVolume(item.volume))} 方</td><td>${escapeHtml(item.drivers.join("、") || "未填写驾驶员")}</td><td>${escapeHtml(item.remark)}</td></tr>`).join("")
    : emptyRow(4);
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json; charset=utf-8", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorPayload = payload as { error?: string; details?: unknown };
    const details = Array.isArray(errorPayload.details) ? `：${errorPayload.details.join("、")}` : "";
    throw new Error(`${errorPayload.error || "请求失败"}${details}`);
  }
  return payload as T;
}

function activateTab(panelId: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    tab.classList.toggle("active", tab.dataset.tab === panelId);
  }
  for (const panel of document.querySelectorAll<HTMLElement>(".tab-panel")) {
    panel.classList.toggle("active", panel.id === panelId);
  }
}

function setDatalist(selector: string, values: string[]): void {
  const list = requiredElement<HTMLDataListElement>(selector);
  list.innerHTML = unique(values)
    .map((value) => `<option value="${escapeHtml(value)}"></option>`)
    .join("");
}

function resetFormForNextEntry(form: HTMLFormElement): void {
  form.reset();
  const dateInput = form.querySelector<HTMLInputElement>('input[type="date"]');
  if (dateInput) dateInput.value = defaultDate;
}

function emptyRow(colspan: number): string {
  return `<tr><td colspan="${colspan}" class="empty-cell">当前日期没有匹配的作业内容</td></tr>`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort(compareByChineseStroke);
}

function uniqueInInputOrder(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function roundVolume(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}


function compareByChineseStroke(a: string, b: string): number {
  const strokeResult = strokeCollator.compare(a, b);
  return strokeResult || fallbackCollator.compare(a, b);
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function toDateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function formatVolume(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value || 0);
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToastTimer);
  showToastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

let showToastTimer = 0;

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function requiredChild<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing child element: ${selector}`);
  return element;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}



