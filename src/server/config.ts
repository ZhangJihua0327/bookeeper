import { existsSync, readFileSync } from "node:fs";

loadDotEnv();

const env = process.env;

export interface FieldConfig {
  date: string;
  customerName: string;
  volume: string;
}

export interface PumpTruckFieldConfig extends FieldConfig {
  truckModel: string;
  location: string;
}

export interface MixerTruckFieldConfig extends FieldConfig {
  remark: string;
  drivers: string;
}

export interface AppConfig {
  port: number;
  timeZone: string;
  feishu: {
    appId: string;
    appSecret: string;
    baseUrl: string;
  };
  bitable: {
    appToken: string;
    pumpTruckTableId: string;
    mixerTruckTableId: string;
    fields: {
      pumpTruck: PumpTruckFieldConfig;
      mixerTruck: MixerTruckFieldConfig;
    };
  };
}

export const config: AppConfig = {
  port: Number(env.PORT || 3000),
  timeZone: env.TIME_ZONE || "Asia/Shanghai",
  feishu: {
    appId: env.FEISHU_APP_ID || "",
    appSecret: env.FEISHU_APP_SECRET || "",
    baseUrl: env.FEISHU_BASE_URL || "https://open.feishu.cn",
  },
  bitable: {
    appToken: env.BITABLE_APP_TOKEN || "",
    pumpTruckTableId: env.PUMP_TRUCK_TABLE_ID || "",
    mixerTruckTableId: env.MIXER_TRUCK_TABLE_ID || "",
    fields: {
      pumpTruck: {
        date: env.PUMP_FIELD_DATE || "日期",
        truckModel: env.PUMP_FIELD_TRUCK_MODEL || "车型",
        customerName: env.PUMP_FIELD_CUSTOMER_NAME || "客户名称",
        volume: env.PUMP_FIELD_VOLUME || "方量",
        location: env.PUMP_FIELD_LOCATION || "施工地点",
      },
      mixerTruck: {
        date: env.MIXER_FIELD_DATE || "日期",
        customerName: env.MIXER_FIELD_CUSTOMER_NAME || "客户名称",
        volume: env.MIXER_FIELD_VOLUME || "方量",
        remark: env.MIXER_FIELD_REMARK || "备注",
        drivers: env.MIXER_FIELD_DRIVERS || "驾驶员",
      },
    },
  },
};

export function getMissingConfig(): string[] {
  const required: Record<string, string> = {
    FEISHU_APP_ID: config.feishu.appId,
    FEISHU_APP_SECRET: config.feishu.appSecret,
    BITABLE_APP_TOKEN: config.bitable.appToken,
    PUMP_TRUCK_TABLE_ID: config.bitable.pumpTruckTableId,
    MIXER_TRUCK_TABLE_ID: config.bitable.mixerTruckTableId,
  };

  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
