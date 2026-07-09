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
  volume: number | string;
  remark: string;
  drivers: string[];
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
  return {
    [fieldNames.date]: dateStringToFeishuTimestamp(input.date),
    [fieldNames.customerName]: input.customerName.trim(),
    [fieldNames.volume]: Number(input.volume),
    [fieldNames.remark]: input.remark.trim(),
    [fieldNames.drivers]: input.drivers.map((name) => name.trim()).filter(Boolean),
  };
}

export function validatePumpTruck(input: Partial<PumpTruckInput>): string[] {
  const errors: string[] = [];
  if (!isDateString(input.date)) errors.push("\u65e5\u671f\u4e0d\u80fd\u4e3a\u7a7a");
  if (!trimmed(input.truckModel)) errors.push("\u8f66\u578b\u4e0d\u80fd\u4e3a\u7a7a");
  if (!trimmed(input.customerName)) errors.push("\u5ba2\u6237\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a");
  if (!positiveNumber(input.volume)) errors.push("\u65b9\u91cf\u5fc5\u987b\u5927\u4e8e 0");
  if (!trimmed(input.location)) errors.push("\u65bd\u5de5\u5730\u70b9\u4e0d\u80fd\u4e3a\u7a7a");
  return errors;
}

export function validateMixerTruck(input: Partial<MixerTruckInput>): string[] {
  const errors: string[] = [];
  if (!isDateString(input.date)) errors.push("\u65e5\u671f\u4e0d\u80fd\u4e3a\u7a7a");
  if (!trimmed(input.customerName)) errors.push("\u5ba2\u6237\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a");
  if (!positiveNumber(input.volume)) errors.push("\u65b9\u91cf\u5fc5\u987b\u5927\u4e8e 0");
  if (!trimmed(input.remark)) errors.push("\u5907\u6ce8\u4e0d\u80fd\u4e3a\u7a7a");
  if (!Array.isArray(input.drivers) || input.drivers.map((name) => name.trim()).filter(Boolean).length === 0) {
    errors.push("\u9a7e\u9a76\u5458\u81f3\u5c11\u9009\u62e9\u6216\u586b\u5199 1 \u4e2a");
  }
  return errors;
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
    `${date} \u4f5c\u4e1a\u5185\u5bb9\u62a5\u8868`,
    `\u603b\u65b9\u91cf\uff1a${formatNumber(totalVolume)} \u65b9`,
    `\u6cf5\u8f66\uff1a${pumpItems.length} \u6761\uff0c${formatNumber(pumpVolume)} \u65b9`,
    `\u6405\u62cc\u8f66\uff1a${mixerItems.length} \u6761\uff0c${formatNumber(mixerVolume)} \u65b9`,
  ];

  if (pumpItems.length) {
    lines.push("", "\u6cf5\u8f66\u660e\u7ec6\uff1a");
    for (const item of pumpItems) {
      lines.push(`- ${item.customerName}\uff5c${item.truckModel}\uff5c${formatNumber(item.volume)} \u65b9\uff5c${item.location}`);
    }
  }

  if (mixerItems.length) {
    lines.push("", "\u6405\u62cc\u8f66\u660e\u7ec6\uff1a");
    for (const item of mixerItems) {
      const drivers = item.drivers.length ? `\uff5c${item.drivers.join("\u3001")}` : "";
      lines.push(`- ${item.customerName}\uff5c${formatNumber(item.volume)} \u65b9${drivers}\uff5c${item.remark}`);
    }
  }

  return lines.join("\n");
}

function groupVolumeByCustomer(records: Array<NormalizedPumpTruckRecord | NormalizedMixerTruckRecord>) {
  const groups = new Map<string, number>();
  for (const record of records) {
    const key = record.customerName || "\u672a\u586b\u5199\u5ba2\u6237";
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
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("\u3001");
  if (typeof value === "object") {
    const objectValue = value as { text?: unknown; name?: unknown; value?: unknown };
    return String(objectValue.text || objectValue.name || objectValue.value || "");
  }
  return String(value);
}

function listValue(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(textValue).map((item) => item.trim()).filter(Boolean);
  return String(value).split(/[\u3001,\uff0c\s]+/).map((item) => item.trim()).filter(Boolean);
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
