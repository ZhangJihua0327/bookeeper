export interface FeishuClientConfig {
  appId: string;
  appSecret: string;
  appToken: string;
  baseUrl: string;
}

interface FeishuResponse<T = unknown> {
  code?: number;
  msg?: string;
  request_id?: string;
  data?: T;
  tenant_access_token?: string;
  expire?: number;
}

export interface FeishuRecord {
  record_id?: string;
  recordId?: string;
  fields?: Record<string, unknown>;
}

export interface FeishuFieldOption {
  id?: string;
  name?: string;
  color?: number;
}

export interface FeishuField {
  field_id?: string;
  fieldId?: string;
  field_name?: string;
  fieldName?: string;
  type?: number;
  property?: {
    options?: FeishuFieldOption[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class FeishuApiError extends Error {
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "FeishuApiError";
    this.details = details;
  }
}

export class FeishuBitableClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly appToken: string;
  private readonly baseUrl: string;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor({ appId, appSecret, appToken, baseUrl }: FeishuClientConfig) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.appToken = appToken;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async createRecord(tableId: string, fields: Record<string, unknown>): Promise<FeishuRecord | unknown> {
    const body = await this.request<{ record?: FeishuRecord }>(
      "POST",
      `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records`,
      { fields },
    );

    return body.data?.record || body.data;
  }

  async listRecords(tableId: string, options: { pageSize?: number; maxPages?: number } = {}): Promise<FeishuRecord[]> {
    const pageSize = options.pageSize ?? 500;
    const maxPages = options.maxPages ?? 20;
    const records: FeishuRecord[] = [];
    let pageToken = "";

    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({ page_size: String(pageSize) });
      if (pageToken) query.set("page_token", pageToken);

      const body = await this.request<{ items?: FeishuRecord[]; has_more?: boolean; page_token?: string }>(
        "GET",
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records?${query}`,
      );

      records.push(...(body.data?.items || []));
      if (!body.data?.has_more) break;
      pageToken = body.data?.page_token || "";
      if (!pageToken) break;
    }

    return records;
  }

  async listFields(tableId: string): Promise<FeishuField[]> {
    const fields: FeishuField[] = [];
    let pageToken = "";

    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ page_size: "100" });
      if (pageToken) query.set("page_token", pageToken);

      const body = await this.request<{ items?: FeishuField[]; has_more?: boolean; page_token?: string }>(
        "GET",
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/fields?${query}`,
      );

      fields.push(...(body.data?.items || []));
      if (!body.data?.has_more) break;
      pageToken = body.data?.page_token || "";
      if (!pageToken) break;
    }

    return fields;
  }

  async getFieldOptions(tableId: string, fieldName: string): Promise<string[]> {
    const field = await this.findField(tableId, fieldName);
    return optionNames(field);
  }

  async addFieldOption(tableId: string, fieldName: string, optionName: string): Promise<{ added: boolean; options: string[] }> {
    const cleaned = optionName.trim();
    if (!cleaned) return { added: false, options: [] };

    const field = await this.findField(tableId, fieldName);
    const existingOptions = field.property?.options || [];
    const existingNames = optionNames(field);
    if (existingNames.includes(cleaned)) {
      return { added: false, options: existingNames };
    }

    const fieldId = field.field_id || field.fieldId;
    if (!fieldId) {
      throw new FeishuApiError(`Field ${fieldName} has no field_id`, { tableId, fieldName });
    }

    const nextOptions = [...existingOptions, { name: cleaned }];
    const payload: Record<string, unknown> = {
      property: {
        ...(field.property || {}),
        options: nextOptions,
      },
    };
    if (typeof field.type === "number") payload.type = field.type;

    await this.request(
      "PUT",
      `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/fields/${encodeURIComponent(fieldId)}`,
      payload,
    );

    return { added: true, options: [...existingNames, cleaned] };
  }

  async ensureFieldOptions(tableId: string, fieldName: string, values: string[]): Promise<string[]> {
    const added: string[] = [];
    for (const value of uniqueCleanValues(values)) {
      const result = await this.addFieldOption(tableId, fieldName, value);
      if (result.added) added.push(value);
    }
    return added;
  }

  private async findField(tableId: string, fieldName: string): Promise<FeishuField> {
    const fields = await this.listFields(tableId);
    const field = fields.find((item) => (item.field_name || item.fieldName) === fieldName);
    if (!field) {
      throw new FeishuApiError(`Field ${fieldName} not found`, { tableId, fieldName });
    }
    return field;
  }

  private async request<T>(method: string, path: string, payload?: unknown): Promise<FeishuResponse<T>> {
    const token = await this.getTenantAccessToken();
    const response = await this.fetchResponse(method, path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

    return parseFeishuResponse<T>(response);
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const tokenPath = "/open-apis/auth/v3/tenant_access_token/internal";
    const response = await this.fetchResponse("POST", tokenPath, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    const body = await parseFeishuResponse(response);
    const token = body.tenant_access_token;
    if (!token) {
      throw new FeishuApiError("Feishu did not return tenant_access_token", body as Record<string, unknown>);
    }

    const expiresInSeconds = Number(body.expire || 7200);
    this.cachedToken = token;
    this.tokenExpiresAt = now + Math.max(expiresInSeconds - 300, 60) * 1000;
    return token;
  }

  private async fetchResponse(method: string, path: string, init: RequestInit): Promise<Response> {
    const maxAttempts = method === "GET" ? 2 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${this.baseUrl}${path}`, init);
        console.log(`Feishu ${method} ${safePath(path)} ${response.status} ${Date.now() - startedAt}ms attempt=${attempt}`);
        return response;
      } catch (error) {
        lastError = error;
        console.error(`Feishu ${method} ${safePath(path)} connection failed after ${Date.now() - startedAt}ms attempt=${attempt}`, error);
        if (attempt < maxAttempts) await delay(200);
      }
    }

    throw new FeishuApiError("连接飞书接口失败", {
      method,
      path: safePath(path),
      cause: lastError instanceof Error ? lastError.message : String(lastError),
    });
  }
}

function optionNames(field: FeishuField): string[] {
  return (field.property?.options || [])
    .map((option) => option.name || "")
    .map((name) => name.trim())
    .filter(Boolean);
}

function uniqueCleanValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function safePath(path: string): string {
  return path
    .split("?", 1)[0]
    .replace(/\/apps\/[^/]+/, "/apps/:app")
    .replace(/\/tables\/[^/]+/, "/tables/:table")
    .replace(/\/records\/[^/]+/, "/records/:record");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function parseFeishuResponse<T>(response: Response): Promise<FeishuResponse<T>> {
  const text = await response.text();
  let body: FeishuResponse<T>;
  try {
    body = text ? JSON.parse(text) as FeishuResponse<T> : {};
  } catch (error) {
    throw new FeishuApiError(`Feishu returned non-JSON response (${response.status})`, {
      status: response.status,
      body: text,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (!response.ok || body.code !== 0) {
    throw new FeishuApiError(body.msg || `Feishu API request failed (${response.status})`, {
      status: response.status,
      code: body.code,
      message: body.msg,
      requestId: body.request_id,
    });
  }

  return body;
}
