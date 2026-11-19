/**
 * 两张“表”的列定义。
 * 公式变量的名字就是这里的中文 label，与用户在表格里看到的列名一致。
 */

export const SCOPES = {
  pump: {
    key: "pump",
    label: "泵车",
    tableName: "泵车表",
    fields: [
      { key: "entry_date", label: "日期", type: "date", required: true },
      { key: "truck_model", label: "车型", type: "dict", dict: "truck_model", required: true },
      { key: "customer_name", label: "客户名称", type: "dict", dict: "customer", required: true },
      { key: "volume", label: "方量", type: "number", required: true },
      { key: "location", label: "施工地点", type: "dict", dict: "location", required: true },
      { key: "remark", label: "备注", type: "text", required: false, placeholder: "选填" },
    ],
  },
  mixer: {
    key: "mixer",
    label: "搅拌车",
    tableName: "搅拌车表",
    fields: [
      { key: "entry_date", label: "日期", type: "date", required: true },
      { key: "customer_name", label: "客户名称", type: "dict", dict: "customer", required: true },
      { key: "volume", label: "方量", type: "number", required: true, hint: "留空时按备注里的算式自动计算" },
      { key: "remark", label: "备注", type: "text", required: true, placeholder: "12*2+11" },
      { key: "driver", label: "驾驶员", type: "dict", dict: "driver", required: false, placeholder: "多人用顿号分隔" },
      { key: "truck_model", label: "车型", type: "dict", dict: "truck_model", required: false },
      { key: "location", label: "施工地点", type: "dict", dict: "location", required: false },
    ],
  },
};

export const SCOPE_KEYS = Object.keys(SCOPES);

export const DICT_KINDS = {
  customer: { label: "客户名称", scopes: ["pump", "mixer"] },
  truck_model: { label: "车型", scopes: ["pump", "mixer"] },
  location: { label: "施工地点", scopes: ["pump", "mixer"] },
  driver: { label: "驾驶员", scopes: ["mixer"] },
};

export function isScope(value) {
  return Object.prototype.hasOwnProperty.call(SCOPES, value);
}

export function scopeDef(scope) {
  return SCOPES[scope] || SCOPES.pump;
}

/** 把一条数据库记录转成“列名 → 值”，供公式引擎使用。 */
export function toFormulaValues(scope, row) {
  const values = {};
  for (const field of scopeDef(scope).fields) {
    const raw = row[field.key];
    if (field.type === "number") {
      values[field.label] = raw === null || raw === undefined || raw === "" ? 0 : Number(raw);
    } else if (field.type === "date") {
      values[field.label] = formatDate(raw);
    } else {
      values[field.label] = raw === null || raw === undefined ? "" : String(raw);
    }
  }
  return values;
}

export function formatDate(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}
