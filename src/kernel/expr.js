// Safe arithmetic expression evaluator for parametric dimensions.
// Supports: numbers, named parameters, + - * / % ^, parentheses, unary +/-,
// unit suffixes (mm, cm, m, in, deg) and math functions.

const FUNCS = {
  sin: (d) => Math.sin((d * Math.PI) / 180),
  cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180),
  asin: (x) => (Math.asin(x) * 180) / Math.PI,
  acos: (x) => (Math.acos(x) * 180) / Math.PI,
  atan: (x) => (Math.atan(x) * 180) / Math.PI,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const CONSTS = { pi: Math.PI, PI: Math.PI, e: Math.E };
const UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, deg: 1 };

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (j < src.length && /[eE]/.test(src[j]) && /[-+0-9]/.test(src[j + 1] || '')) {
        j++;
        if (/[-+]/.test(src[j])) j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      const num = Number(src.slice(i, j));
      if (Number.isNaN(num)) throw new Error(`Bad number "${src.slice(i, j)}"`);
      tokens.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/%^(),'.includes(c)) { tokens.push({ t: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return tokens;
}

export function evaluate(src, scope = {}) {
  if (typeof src === 'number') return src;
  if (src == null || String(src).trim() === '') throw new Error('Empty value');
  const tokens = tokenize(String(src));
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => {
    if (!tokens[p] || tokens[p].t !== t) throw new Error(`Expected "${t}"`);
    return tokens[p++];
  };

  function primary() {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end');
    if (tok.t === 'num') {
      p++;
      let v = tok.v;
      // optional unit suffix directly after a number, e.g. "2in"
      const nx = peek();
      if (nx && nx.t === 'id' && UNITS[nx.v] !== undefined && !(nx.v in scope)) {
        v *= UNITS[nx.v];
        p++;
      }
      return v;
    }
    if (tok.t === 'id') {
      p++;
      if (peek() && peek().t === '(') {
        const fn = FUNCS[tok.v];
        if (!fn) throw new Error(`Unknown function "${tok.v}"`);
        eat('(');
        const args = [];
        if (peek() && peek().t !== ')') {
          args.push(expr());
          while (peek() && peek().t === ',') { p++; args.push(expr()); }
        }
        eat(')');
        return fn(...args);
      }
      if (Object.prototype.hasOwnProperty.call(scope, tok.v)) return scope[tok.v];
      if (CONSTS[tok.v] !== undefined) return CONSTS[tok.v];
      throw new Error(`Unknown parameter "${tok.v}"`);
    }
    if (tok.t === '(') {
      p++;
      const v = expr();
      eat(')');
      return v;
    }
    throw new Error(`Unexpected "${tok.t}"`);
  }
  function unary() {
    const tok = peek();
    if (tok && (tok.t === '-' || tok.t === '+')) {
      p++;
      const v = unary();
      return tok.t === '-' ? -v : v;
    }
    return power();
  }
  function power() {
    const base = primary();
    if (peek() && peek().t === '^') {
      p++;
      return Math.pow(base, unary());
    }
    return base;
  }
  function term() {
    let v = unary();
    while (peek() && '*/%'.includes(peek().t)) {
      const op = tokens[p++].t;
      const r = unary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = tokens[p++].t;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  const v = expr();
  if (p < tokens.length) throw new Error(`Unexpected "${tokens[p].v ?? tokens[p].t}"`);
  if (!Number.isFinite(v)) throw new Error('Result is not a finite number');
  return v;
}

/** Evaluate the user parameter table in order; later params may reference earlier ones. */
export function evaluateParameters(params = []) {
  const scope = {};
  const errors = {};
  for (const prm of params) {
    if (!prm.name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(prm.name)) {
      errors[prm.name || '?'] = 'Invalid name';
      continue;
    }
    try {
      scope[prm.name] = evaluate(prm.expr, scope);
    } catch (e) {
      errors[prm.name] = e.message;
    }
  }
  return { scope, errors };
}
