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
const reportText = requiredElement<HTMLPreElement>("#reportText");
const pumpReportDetails = requiredElement<HTMLTableSectionElement>("#pumpReportDetails");
const mixerReportDetails = requiredElement<HTMLTableSectionElement>("#mixerReportDetails");
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
reportDate.addEventListener("change", loadReport);

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
  const payload = {
    date: stringValue(form.get("date")),
    customerName: stringValue(form.get("customerName")),
    volume: Number(form.get("volume")),
    remark: stringValue(form.get("remark")),
    drivers: splitDrivers(form.get("drivers")),
    addMissingOptions: true,
  };

  await submitRecord("/api/records/mixer-truck", payload, mixerForm, "搅拌车记录已提交");
}

async function submitRecord(path: string, payload: unknown, form: HTMLFormElement, message: string): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>("button");
  if (button) button.disabled = true;
  try {
    const result = await request<{ addedOptions?: string[] }>(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const added = result.addedOptions?.length ? `，新增选项：${result.addedOptions.join("、")}` : "";
    showToast(`${message}${added}`);
    form.reset();
    const dateInput = form.querySelector<HTMLInputElement>('input[type="date"]');
    if (dateInput) dateInput.value = defaultDate;
    await Promise.all([loadReport(), loadOptions()]);
  } catch (error) {
    showToast(messageFromError(error));
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadReport(): Promise<void> {
  try {
    const query = reportDate.value ? `?date=${encodeURIComponent(reportDate.value)}` : "";
    const report = await request<ReportResponse>(`/api/report/yesterday${query}`);
    renderReport(report);
  } catch (error) {
    reportText.textContent = messageFromError(error);
    pumpReportDetails.innerHTML = emptyRow(4);
    mixerReportDetails.innerHTML = emptyRow(4);
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

function splitDrivers(value: FormDataEntryValue | null): string[] {
  return stringValue(value)
    .split(/[、,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort(compareByChineseStroke);
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

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}








