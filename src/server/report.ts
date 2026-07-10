import type { MixerTruckFieldConfig, PumpTruckFieldConfig } from "./config.js";
import type { FeishuRecord } from "./feishu.js";

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export interface PumpTruckInput {
  date: string;
  truckModel: string;
  customerName: string;
  volume: number | string;
  location: string;
}

export interface MixerTruckInput {
  date: string;
  customerName: string;
  remark: string;
  volume?: number | string;
  drivers?: string[];
}

export interface MixerTruckRemarkEntry {
  driver: string;
  expression: string;
  volume: number;
}

export interface ParsedMixerTruckRemark {
  remark: string;
  entries: MixerTruckRemarkEntry[];
  drivers: string[];
  totalVolume: number;
  errors: string[];
}

export interface NormalizedPumpTruckRecord {
  id: string;
  type: "pump_truck";
  date: string;
  truckModel: string;
  customerName: string;
  volume: number;
  location: string;
}

export interface NormalizedMixerTruckRecord {
  id: string;
  type: "mixer_truck";
  date: string;
  customerName: string;
  volume: number;
  remark: string;
  drivers: string[];
}

export interface VehicleReport {
  date: string;
  summary: {
    pumpTruckCount: number;
    mixerTruckCount: number;
    pumpTruckVolume: number;
    mixerTruckVolume: number;
    totalVolume: number;
  };
  pumpTruck: NormalizedPumpTruckRecord[];
  mixerTruck: NormalizedMixerTruckRecord[];
  byCustomer: Array<{ customerName: string; volume: number }>;
  text: string;
}

interface ReportOptions {
  date: string;
  pumpRecords: FeishuRecord[];
  mixerRecords: FeishuRecord[];
  fields: {
    pumpTruck: PumpTruckFieldConfig;
    mixerTruck: MixerTruckFieldConfig;
  };
  timeZone: string;
}

export function dateStringToFeishuTimestamp(dateString: string): number {
  assertDateString(dateString);
  return new Date(`${dateString}T00:00:00+08:00`).getTime();
}

export function getYesterdayDate(timeZone: string): string {
  const todayParts = getDateParts(new Date(), timeZone);
  const todayUtcNoon = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day, 12);
  return formatDateInTimeZone(new Date(todayUtcNoon - 24 * 60 * 60 * 1000), timeZone);
}

export function normalizeRecordDate(value: unknown, timeZone: string): string {
  if (typeof value === "number") return formatDateInTimeZone(new Date(value), timeZone);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return formatDateInTimeZone(new Date(Number(value)), timeZone);
  }
  return "";
}

export function buildYesterdayReport({ date, pumpRecords, mixerRecords, fields, timeZone }: ReportOptions): VehicleReport {
  const pumpItems = normalizePumpRecords(pumpRecords, fields.pumpTruck, timeZone)
    .filter((record) => record.date === date);
  const mixerItems = normalizeMixerRecords(mixerRecords, fields.mixerTruck, timeZone)
    .filter((record) => record.date === date);

  const pumpVolume = sumBy(pumpItems, "volume");
  const mixerVolume = sumBy(mixerItems, "volume");
  const totalVolume = pumpVolume + mixerVolume;

  return {
    date,
    summary: {
      pumpTruckCount: pumpItems.length,
      mixerTruckCount: mixerItems.length,
      pumpTruckVolume: pumpVolume,
      mixerTruckVolume: mixerVolume,
      totalVolume,
    },
    pumpTruck: pumpItems,
    mixerTruck: mixerItems,
    byCustomer: groupVolumeByCustomer([...pumpItems, ...mixerItems]),
    text: buildReportText(date, pumpItems, mixerItems, pumpVolume, mixerVolume, totalVolume),
  };
}

export function normalizePumpRecords(
  records: FeishuRecord[],
  fieldNames: PumpTruckFieldConfig,
  timeZone: string,
): NormalizedPumpTruckRecord[] {
  return records.map((record) => {
    const fields = record.fields || {};
    return {
      id: record.record_id || record.recordId || "",
      type: "pump_truck",
      date: normalizeRecordDate(fields[fieldNames.date], timeZone),
      truckModel: textValue(fields[fieldNames.truckModel]),
      customerName: textValue(fields[fieldNames.customerName]),
      volume: numberValue(fields[fieldNames.volume]),
      location: textValue(fields[fieldNames.location]),
    };
  });
}

export function normalizeMixerRecords(
  records: FeishuRecord[],
  fieldNames: MixerTruckFieldConfig,
  timeZone: string,
): NormalizedMixerTruckRecord[] {
  return records.map((record) => {
    const fields = record.fields || {};
    return {
      id: record.record_id || record.recordId || "",
      type: "mixer_truck",
      date: normalizeRecordDate(fields[fieldNames.date], timeZone),
      customerName: textValue(fields[fieldNames.customerName]),
      volume: numberValue(fields[fieldNames.volume]),
      remark: textValue(fields[fieldNames.remark]),
      drivers: listValue(fields[fieldNames.drivers]),
    };
  });
}

export function makePumpTruckFields(input: PumpTruckInput, fieldNames: PumpTruckFieldConfig): Record<string, unknown> {
  return {
    [fieldNames.date]: dateStringToFeishuTimestamp(input.date),
    [fieldNames.truckModel]: input.truckModel.trim(),
    [fieldNames.customerName]: input.customerName.trim(),
    [fieldNames.volume]: Number(input.volume),
    [fieldNames.location]: input.location.trim(),
  };
}

export function makeMixerTruckFields(input: MixerTruckInput, fieldNames: MixerTruckFieldConfig): Record<string, unknown> {
  const generated = parseMixerTruckRemark(input.remark);
  if (generated.errors.length) throw new Error(generated.errors.join("；"));
  return {
    [fieldNames.date]: dateStringToFeishuTimestamp(input.date),
    [fieldNames.customerName]: input.customerName.trim(),
    [fieldNames.volume]: generated.totalVolume,
    [fieldNames.remark]: generated.remark,
    [fieldNames.drivers]: generated.drivers,
  };
}

export function validatePumpTruck(input: Partial<PumpTruckInput>): string[] {
  const errors: string[] = [];
  if (!isDateString(input.date)) errors.push("日期不能为空");
  if (!trimmed(input.truckModel)) errors.push("车型不能为空");
  if (!trimmed(input.customerName)) errors.push("客户名称不能为空");
  if (!positiveNumber(input.volume)) errors.push("方量必须大于 0");
  if (!trimmed(input.location)) errors.push("施工地点不能为空");
  return errors;
}

export function validateMixerTruck(input: Partial<MixerTruckInput>): string[] {
  const errors: string[] = [];
  if (!isDateString(input.date)) errors.push("日期不能为空");
  if (!trimmed(input.customerName)) errors.push("客户名称不能为空");
  errors.push(...parseMixerTruckRemark(input.remark).errors);
  return errors;
}

export function parseMixerTruckRemark(value: unknown): ParsedMixerTruckRemark {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return emptyParsedRemark(["运输明细不能为空"]);

  const entries: MixerTruckRemarkEntry[] = [];
  const errors: string[] = [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const [index, line] of lines.entries()) {
    const separatorIndex = line.search(/[：:]/);
    if (separatorIndex < 1) {
      errors.push(`第 ${index + 1} 条应为“驾驶员：每车方量算式”`);
      continue;
    }

    const driver = line.slice(0, separatorIndex).trim();
    const expression = line.slice(separatorIndex + 1).trim();
    if (!driver) {
      errors.push(`第 ${index + 1} 条驾驶员不能为空`);
      continue;
    }

    const evaluated = evaluateVolumeExpression(expression);
    if (evaluated.error) {
      errors.push(`第 ${index + 1} 条${evaluated.error}`);
      continue;
    }
    entries.push({ driver, expression: evaluated.normalized, volume: evaluated.value });
  }

  if (errors.length) return emptyParsedRemark(errors);
  const drivers = [...new Set(entries.map((entry) => entry.driver))];
  const totalVolume = roundVolume(entries.reduce((total, entry) => total + entry.volume, 0));
  return {
    entries,
    drivers,
    totalVolume,
    remark: entries.map((entry) => `${entry.driver}：${entry.expression}`).join("\n"),
    errors: [],
  };
}

export function evaluateVolumeExpression(value: unknown): { value: number; normalized: string; error: string } {
  const normalized = typeof value === "string"
    ? value.trim().replaceAll("＋", "+").replace(/[xX*]/g, "×").replaceAll(/\s/g, "")
    : "";
  if (!normalized) return { value: 0, normalized, error: "每车方量不能为空" };
  if (!/^\d+(?:\.\d+)?(?:[+×]\d+(?:\.\d+)?)*$/.test(normalized)) {
    return { value: 0, normalized, error: "方量只能使用数字、加号和乘号" };
  }

  const result = normalized.split("+").reduce((sum, product) => {
    return sum + product.split("×").reduce((value, factor) => value * Number(factor), 1);
  }, 0);
  if (!Number.isFinite(result) || result <= 0) {
    return { value: 0, normalized, error: "计算后的方量必须大于 0" };
  }
  return { value: roundVolume(result), normalized, error: "" };
}

function emptyParsedRemark(errors: string[]): ParsedMixerTruckRemark {
  return { remark: "", entries: [], drivers: [], totalVolume: 0, errors };
}

function roundVolume(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function buildReportText(
  date: string,
  pumpItems: NormalizedPumpTruckRecord[],
  mixerItems: NormalizedMixerTruckRecord[],
  pumpVolume: number,
  mixerVolume: number,
  totalVolume: number,
): string {
  const lines = [
    `${date} 作业内容报表`,
    `总方量：${formatNumber(totalVolume)} 方`,
    `泵车：${pumpItems.length} 条，${formatNumber(pumpVolume)} 方`,
    `搅拌车：${mixerItems.length} 条，${formatNumber(mixerVolume)} 方`,
  ];

  if (pumpItems.length) {
    lines.push("", "泵车明细：");
    for (const item of pumpItems) {
      lines.push(`- ${item.customerName}｜${item.truckModel}｜${formatNumber(item.volume)} 方｜${item.location}`);
    }
  }

  if (mixerItems.length) {
    lines.push("", "搅拌车明细：");
    for (const item of mixerItems) {
      const drivers = item.drivers.length ? `｜${item.drivers.join("、")}` : "";
      lines.push(`- ${item.customerName}｜${formatNumber(item.volume)} 方${drivers}｜${item.remark}`);
    }
  }

  return lines.join("\n");
}

function groupVolumeByCustomer(records: Array<NormalizedPumpTruckRecord | NormalizedMixerTruckRecord>) {
  const groups = new Map<string, number>();
  for (const record of records) {
    const key = record.customerName || "未填写客户";
    groups.set(key, (groups.get(key) || 0) + record.volume);
  }
  return [...groups.entries()]
    .map(([customerName, volume]) => ({ customerName, volume }))
    .sort((a, b) => b.volume - a.volume);
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("、");
  if (typeof value === "object") {
    const objectValue = value as { text?: unknown; name?: unknown; value?: unknown };
    return String(objectValue.text || objectValue.name || objectValue.value || "");
  }
  return String(value);
}

function listValue(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(textValue).map((item) => item.trim()).filter(Boolean);
  return String(value).split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean);
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sumBy(records: Array<{ volume: number }>, key: "volume"): number {
  return records.reduce((total, record) => total + numberValue(record[key]), 0);
}

function trimmed(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveNumber(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function assertDateString(value: string): void {
  if (!isDateString(value)) throw new Error("Invalid date string");
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function getDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = getDateParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
