/**
 * 可配置公式引擎。
 *
 * 支持：
 *  - 四则运算 + - * / %、乘方省略写法（12*2）
 *  - 括号、比较运算 < > <= >= == !=、逻辑 && || !
 *  - 变量：表格的列名（日期、车型、客户名称、方量、备注）+ 单价
 *  - 函数：单价()、算式()、round()、max()、min()、abs()、if()
 *
 * 设计上不使用 eval / new Function，防止公式被用来执行任意代码。
 */

export class FormulaError extends Error {
  constructor(message, position = -1) {
    super(message);
    this.name = "FormulaError";
    this.position = position;
  }
}

const OPERATORS = ["&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "<", ">", "(", ")", ",", "!", "?"];

const PRECEDENCE = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

const FULL_WIDTH = [
  ["（", "("],
  ["）", ")"],
  ["，", ","],
  ["×", "*"],
  ["✕", "*"],
  ["✖", "*"],
  ["＊", "*"],
  ["÷", "/"],
  ["／", "/"],
  ["＋", "+"],
  ["－", "-"],
  ["—", "-"],
  ["！", "!"],
  ["≤", "<="],
  ["≥", ">="],
];

function normalize(source) {
  let text = String(source ?? "");
  for (const [from, to] of FULL_WIDTH) {
    text = text.split(from).join(to);
  }
  return text;
}

export function tokenize(source) {
  const text = normalize(source);
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(text[index + 1] || ""))) {
      const match = /^\d*\.?\d+/.exec(text.slice(index));
      if (!match) throw new FormulaError(`数字格式错误：${text.slice(index, index + 8)}`, index);
      tokens.push({ type: "number", value: Number(match[0]), pos: index });
      index += match[0].length;
      continue;
    }

    if (char === '"' || char === "'" || char === "“") {
      const close = char === "“" ? "”" : char;
      const end = text.indexOf(close, index + 1);
      if (end < 0) throw new FormulaError("字符串缺少结束引号", index);
      tokens.push({ type: "string", value: text.slice(index + 1, end), pos: index });
      index = end + 1;
      continue;
    }

    const ident = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(text.slice(index));
    if (ident) {
      tokens.push({ type: "ident", value: ident[0], pos: index });
      index += ident[0].length;
      continue;
    }

    const operator = OPERATORS.find((candidate) => text.startsWith(candidate, index));
    if (!operator) {
      throw new FormulaError(`无法识别的字符“${char}”`, index);
    }
    tokens.push({ type: "op", value: operator, pos: index });
    index += operator.length;
  }

  tokens.push({ type: "end", value: "", pos: text.length });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek() {
    return this.tokens[this.index];
  }

  next() {
    return this.tokens[this.index++];
  }

  isOp(value) {
    const token = this.peek();
    return token.type === "op" && token.value === value;
  }

  expectOp(value) {
    const token = this.next();
    if (token.type !== "op" || token.value !== value) {
      throw new FormulaError(`缺少“${value}”`, token.pos);
    }
  }

  parse() {
    const node = this.parseExpression(0);
    if (this.peek().type !== "end") {
      const token = this.peek();
      throw new FormulaError(`多余的内容“${token.value}”`, token.pos);
    }
    return node;
  }

  parseExpression(minPrecedence) {
    let left = this.parseUnary();

    for (;;) {
      const token = this.peek();
      if (token.type !== "op") break;
      const precedence = PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      this.next();
      const right = this.parseExpression(precedence + 1);
      left = { type: "binary", op: token.value, left, right };
    }

    return left;
  }

  parseUnary() {
    const token = this.peek();
    if (token.type === "op" && (token.value === "-" || token.value === "+" || token.value === "!")) {
      this.next();
      return { type: "unary", op: token.value, argument: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.next();

    if (token.type === "number") return { type: "number", value: token.value };
    if (token.type === "string") return { type: "string", value: token.value };

    if (token.type === "ident") {
      if (this.isOp("(")) {
        this.next();
        const args = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.parseExpression(0));
            if (this.isOp(",")) {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expectOp(")");
        return { type: "call", name: token.value, args, pos: token.pos };
      }
      return { type: "variable", name: token.value, pos: token.pos };
    }

    if (token.type === "op" && token.value === "(") {
      const inner = this.parseExpression(0);
      this.expectOp(")");
      return inner;
    }

    throw new FormulaError(`意外的“${token.value || "结尾"}”`, token.pos);
  }
}

const parseCache = new Map();

export function parseFormula(source) {
  const key = String(source ?? "");
  if (parseCache.has(key)) return parseCache.get(key);
  const ast = new Parser(tokenize(key)).parse();
  if (parseCache.size > 200) parseCache.clear();
  parseCache.set(key, ast);
  return ast;
}

function toNumber(value, label) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FormulaError(`“${label}”不是有效数字`);
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value ?? "").trim();
  if (text === "") return 0;
  const number = Number(text);
  if (!Number.isFinite(number)) throw new FormulaError(`“${label}”不是数字（当前值：${text}）`);
  return number;
}

function toText(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function compare(left, right) {
  const leftNumber = typeof left === "number" ? left : Number(String(left ?? "").trim());
  const rightNumber = typeof right === "number" ? right : Number(String(right ?? "").trim());
  const bothNumeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  if (bothNumeric) return { a: leftNumber, b: rightNumber };
  return { a: toText(left), b: toText(right) };
}

function makeContext(values, priceLookup) {
  const context = {
    values,
    missingPrices: new Set(),
    price(customer, model) {
      const useCustomer = customer === undefined ? values["客户名称"] : customer;
      const useModel = model === undefined ? values["车型"] : model;
      const result = priceLookup(toText(useCustomer), toText(useModel));
      if (result.missing) {
        context.missingPrices.add(`${toText(useCustomer) || "默认"}${useModel ? `/${toText(useModel)}` : ""}`);
        return 0;
      }
      return result.price;
    },
  };
  return context;
}

export function evaluateAst(node, context) {
  switch (node.type) {
    case "number":
      return node.value;

    case "string":
      return node.value;

    case "variable": {
      if (!(node.name in context.values)) {
        const available = Object.keys(context.values).join("、");
        throw new FormulaError(`未知的列或变量“${node.name}”，可用：${available}`, node.pos);
      }
      const value = context.values[node.name];
      return value === null || value === undefined ? "" : value;
    }

    case "unary": {
      const value = evaluateAst(node.argument, context);
      if (node.op === "!") return !value;
      const number = toNumber(value, "运算对象");
      return node.op === "-" ? -number : number;
    }

    case "binary": {
      if (node.op === "&&") {
        return Boolean(evaluateAst(node.left, context)) && Boolean(evaluateAst(node.right, context));
      }
      if (node.op === "||") {
        return Boolean(evaluateAst(node.left, context)) || Boolean(evaluateAst(node.right, context));
      }

      const left = evaluateAst(node.left, context);
      const right = evaluateAst(node.right, context);

      switch (node.op) {
        case "+": {
          if (typeof left === "string" || typeof right === "string") {
            const bothNumeric = Number.isFinite(Number(left)) && Number.isFinite(Number(right));
            if (!bothNumeric) return `${toText(left)}${toText(right)}`;
          }
          return toNumber(left, "左操作数") + toNumber(right, "右操作数");
        }
        case "-":
          return toNumber(left, "左操作数") - toNumber(right, "右操作数");
        case "*":
          return toNumber(left, "左操作数") * toNumber(right, "右操作数");
        case "/": {
          const divisor = toNumber(right, "除数");
          if (divisor === 0) throw new FormulaError("除数不能为 0");
          return toNumber(left, "被除数") / divisor;
        }
        case "%": {
          const divisor = toNumber(right, "除数");
          if (divisor === 0) throw new FormulaError("除数不能为 0");
          return toNumber(left, "被除数") % divisor;
        }
        case "<":
        case ">":
        case "<=":
        case ">=": {
          const { a, b } = compare(left, right);
          if (node.op === "<") return a < b;
          if (node.op === ">") return a > b;
          if (node.op === "<=") return a <= b;
          return a >= b;
        }
        case "==":
          return compare(left, right).a === compare(left, right).b;
        case "!=":
          return compare(left, right).a !== compare(left, right).b;
        default:
          throw new FormulaError(`不支持的运算符“${node.op}”`);
      }
    }

    case "call": {
      const fn = FUNCTIONS[node.name] || FUNCTIONS[node.name.toLowerCase()];
      if (!fn) {
        throw new FormulaError(
          `未知函数“${node.name}”，可用：${[...new Set(Object.keys(FUNCTIONS))].join("、")}`,
          node.pos,
        );
      }
      const args = node.args.map((argument) => evaluateAst(argument, context));
      return fn(context, args);
    }

    default:
      throw new FormulaError(`不支持的表达：${node.type}`);
  }
}

const FUNCTIONS = {
  单价(context, args) {
    return context.price(args[0], args[1]);
  },
  price(context, args) {
    return context.price(args[0], args[1]);
  },
  算式(_context, args) {
    const result = evaluateRemarkExpression(args[0]);
    if (result.error) throw new FormulaError(result.error);
    return result.value;
  },
  calc(_context, args) {
    const result = evaluateRemarkExpression(args[0]);
    if (result.error) throw new FormulaError(result.error);
    return result.value;
  },
  round(_context, args) {
    const value = toNumber(args[0] ?? 0, "round 参数");
    const digits = Math.trunc(toNumber(args[1] ?? 0, "round 位数"));
    const factor = 10 ** Math.min(Math.max(digits, -6), 6);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  },
  四舍五入(context, args) {
    return FUNCTIONS.round(context, args);
  },
  max(_context, args) {
    return Math.max(...args.map((value) => toNumber(value, "max 参数")));
  },
  最大(_context, args) {
    return FUNCTIONS.max(_context, args);
  },
  min(_context, args) {
    return Math.min(...args.map((value) => toNumber(value, "min 参数")));
  },
  最小(_context, args) {
    return FUNCTIONS.min(_context, args);
  },
  abs(_context, args) {
    return Math.abs(toNumber(args[0] ?? 0, "abs 参数"));
  },
  绝对值(_context, args) {
    return FUNCTIONS.abs(_context, args);
  },
  sum(_context, args) {
    return args.reduce((total, value) => total + toNumber(value, "sum 参数"), 0);
  },
  合计(_context, args) {
    return FUNCTIONS.sum(_context, args);
  },
  if(context, args) {
    return args[0] ? args[1] : args[2] ?? 0;
  },
  如果(context, args) {
    return FUNCTIONS.if(context, args);
  },
};

export const FORMULA_VARIABLES = ["日期", "车型", "客户名称", "方量", "备注", "单价"];

export const FORMULA_FUNCTIONS = [
  { name: "单价()", syntax: "单价(客户名称, 车型)", description: "按配置的单价表取价，不填参数则用当前行的客户和车型" },
  { name: "算式()", syntax: "算式(备注)", description: "把备注里的“12*2+11”这类算式求和" },
  { name: "round()", syntax: "round(数值, 小数位)", description: "四舍五入" },
  { name: "if()", syntax: "if(条件, 成立值, 否则值)", description: "条件取值" },
  { name: "max() / min()", syntax: "max(a, b, ...)", description: "取最大 / 最小值" },
  { name: "abs()", syntax: "abs(数值)", description: "取绝对值" },
  { name: "sum()", syntax: "sum(a, b, ...)", description: "求和" },
];

/**
 * 解析备注中的方量算式，如 “12*2+11” → 35，“12*2 10*2+9+3.5” → 56.5。
 * 支持按 “驾驶员：算式” 分行书写，空格视为相加。
 */
export function evaluateRemarkExpression(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { value: 0, error: "备注为空，无法计算方量" };

  let total = 0;
  let used = 0;

  for (const line of text.split(/\r?\n/)) {
    let segment = line.trim();
    if (!segment) continue;

    const separator = Math.max(segment.indexOf("："), segment.indexOf(":"));
    if (separator >= 0) segment = segment.slice(separator + 1).trim();
    if (!segment) continue;

    const normalized = segment
      .replace(/[×✕✖＊]/g, "*")
      .replace(/[÷／]/g, "/")
      .replace(/[＋]/g, "+")
      .replace(/[－—]/g, "-")
      .replace(/([0-9)）])\s+(?=[0-9(（])/g, "$1+")
      .replace(/\s+/g, "");

    let result = evaluateArithmetic(normalized);
    if (result === null) {
      // 台账常写成「12×2 姜」这种带司机姓氏的形式，去掉中文再算一次
      const stripped = normalized.replace(/[\u4e00-\u9fa5]+/g, "");
      if (stripped && stripped !== normalized) result = evaluateArithmetic(stripped);
    }
    if (result === null) return { value: 0, error: `无法识别的方量算式“${segment}”` };
    total += result;
    used += 1;
  }

  if (!used) return { value: 0, error: "备注里没有可计算的方量算式" };
  return { value: roundNumber(total, 3), error: "" };
}

/** 只允许数字与四则运算，供 “算式()” 使用。 */
export function evaluateArithmetic(expression) {
  const text = String(expression ?? "").trim();
  if (!text) return null;
  if (!/^[0-9+\-*/%().\s]+$/.test(text)) return null;
  try {
    const ast = new Parser(tokenize(text)).parse();
    const value = evaluateAst(ast, makeContext({}, () => ({ price: 0, missing: true })));
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function roundNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * 计算一条记录的金额。
 * @param {string} formula 金额公式
 * @param {Record<string, unknown>} values 列名 → 值（已包含“单价”）
 * @param {(customer: string, model: string) => {price: number, missing: boolean, source?: string}} priceLookup
 */
export function computeAmount(formula, values, priceLookup, decimals = 2) {
  try {
    const context = makeContext(values, priceLookup);
    const ast = parseFormula(formula);
    const raw = evaluateAst(ast, context);
    const amount = roundNumber(toNumber(raw, "金额"), decimals);
    return {
      amount,
      error: "",
      missingPrices: [...context.missingPrices],
    };
  } catch (error) {
    return {
      amount: 0,
      error: error instanceof FormulaError ? error.message : String(error?.message || error),
      missingPrices: [],
    };
  }
}

/** 供前端/接口做公式校验与试算。 */
export function evaluateFormula(formula, values, priceLookup) {
  try {
    const context = makeContext(values, priceLookup);
    const ast = parseFormula(formula);
    const result = evaluateAst(ast, context);
    return {
      ok: true,
      value: typeof result === "number" ? roundNumber(result, 6) : result,
      error: "",
      missingPrices: [...context.missingPrices],
    };
  } catch (error) {
    return {
      ok: false,
      value: 0,
      error: error instanceof FormulaError ? error.message : String(error?.message || error),
      missingPrices: [],
    };
  }
}
