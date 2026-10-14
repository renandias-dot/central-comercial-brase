// Mesmo motor de variáveis, contas e regras do runtime.js (que segue o InLead), para o servidor avaliar
// a regra de perfil e a nota do lead com as respostas guardadas. Coberto por logic.test.ts.

export type Cond = {variable?: string; compare?: string; value?: string; number?: number | string};
export type Roles = Cond[][];
type Vars = Record<string, unknown>;

const stripTags = (h: string) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

// Avaliador aritmético seguro (sem eval): números, + - * / %, parênteses e min/max/round/floor/ceil/abs.
export function calcEval(expr: string): number {
  const s = String(expr).replace(/,(?=\d)/g, '.');
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++ };
  const FN: Record<string, (...a: number[]) => number> = {min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs};
  function primary(): number {
    ws();
    if (s[i] === '(') { i++; const v = sum(); ws(); if (s[i] === ')') i++; return v }
    if (s[i] === '-') { i++; return -primary() }
    if (s[i] === '+') { i++; return primary() }
    const m = /^[a-z]+/i.exec(s.slice(i));
    if (m && FN[m[0].toLowerCase()]) {
      i += m[0].length; ws(); const args: number[] = [];
      if (s[i] === '(') { i++; ws(); if (s[i] !== ')') { args.push(sum()); ws(); while (s[i] === ';' || s[i] === '|') { i++; args.push(sum()); ws() } } if (s[i] === ')') i++ }
      return FN[m[0].toLowerCase()](...args.map(Number));
    }
    const n = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (n) { i += n[0].length; return parseFloat(n[0]) }
    const w = /^[^\s()+\-*/%]+/.exec(s.slice(i)); if (w) { i += w[0].length; return 0 }
    i++; return 0;
  }
  function prod(): number { let v = primary(); for (;;) { ws(); const o = s[i]; if (o === '*' || o === '/' || o === '%') { i++; const r = primary(); v = o === '*' ? v * r : o === '/' ? (r === 0 ? 0 : v / r) : (r === 0 ? 0 : v % r) } else return v } }
  function sum(): number { let v = prod(); for (;;) { ws(); const o = s[i]; if (o === '+' || o === '-') { i++; const r = prod(); v = o === '+' ? v + r : v - r } else return v } }
  const v = sum();
  return isFinite(v) ? v : 0;
}
const fmtCalc = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(2);
export function replaceCalc(text: string){
  let out = '', i = 0;
  for (;;) {
    const k = text.indexOf('calc(', i);
    if (k < 0) return out + text.slice(i);
    out += text.slice(i, k);
    let depth = 0, j = k + 4;
    for (; j < text.length; j++) { if (text[j] === '(') depth++; else if (text[j] === ')') { depth--; if (depth === 0) break } }
    out += fmtCalc(calcEval(stripTags(text.slice(k + 5, j))));
    i = j + 1;
  }
}
// "1.234,56" → 1234.56 (só quando o resultado é número).
function normVar(v: string){
  const t = v.includes(',') && v.includes('.') ? (v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '')) : v.replace(',', '.');
  return /^[\d+\-*/().\s]+$/.test(t) && t.trim() !== '' && isFinite(Number(t)) ? String(Number(t)) : v;
}
const VAR_RE = /\{\{\s*([\w.]*)\s*\}\}|@(\w+(?:\.\w+)*)/g;
export function replaceVars(text: unknown, vars: Vars){
  if (text == null) return '';
  return String(text).replace(/&nbsp;/g, ' ').replace(VAR_RE, (m, br, at, off, src) => {
    if (at !== undefined && /[\w.@]/.test(src[off - 1] || '')) return m;
    let k = br != null ? br : at;
    if (!k) return '';
    if (!(k in vars)) { if (/^url\./.test(k)) k = 'tracking.' + k.slice(4); else if (/^value\./.test(k)) k = k.slice(6) }
    return k in vars ? normVar(String(vars[k])) : '';
  });
}
export function interpolate(text: unknown, vars: Vars){
  let t = replaceVars(text, vars);
  if (t.indexOf('calc(') >= 0) t = replaceCalc(t);
  return t;
}
function calcOrNull(s: string){
  const t = String(s == null ? '' : s).trim();
  if (!t || !/^[0-9+\-*/().\s]*$/.test(t) || /[+\-*/.]$/.test(t)) return null;
  let p = 0; for (const ch of t) { if (ch === '(') p++; else if (ch === ')' && --p < 0) return null }
  if (p) return null;
  return calcEval(t);
}
function hasValidVariables(s: unknown, vars: Vars){
  const m = String(s == null ? '' : s).match(/{{[^}]+}}/g);
  if (!m) return true;
  return m.some(x => x.replace(/{{|}}/g, '').trim() in vars);
}
const countIn = (list: string, x: unknown) => typeof list === 'string' && list.trim() ? list.trim().split('|').filter(e => e === String(x)).length : 0;
const percentIn = (list: string, x: unknown) => { const l = String(list ?? '').trim().split('|'); return l.length ? countIn(String(list), x) / l.length * 100 : 0 };
export function evalCond(c: Cond, vars: Vars): boolean {
  if (!c) return false;
  if (!hasValidVariables(c.variable, vars) || !hasValidVariables(c.value, vars)) return false;
  const lv = replaceVars(c.variable, vars), rv = replaceVars(c.value, vars);
  let l: string | number | null = calcOrNull(lv); if (l === null) l = lv;
  let r: string | number | null = calcOrNull(rv); if (r === null) r = rv;
  const i = typeof r === 'string' && r ? r.split(' ').join('|') : r;
  const n = Number(c.number);
  switch (c.compare) {
    case '==': case '=': case 'equals': return l === i;
    case '!=': case '<>': case 'not_equals': return l !== i;
    case '<': return Number(l) < Number(i);
    case '>': return Number(l) > Number(i);
    case '>=': return Number(l) >= Number(i);
    case '<=': return Number(l) <= Number(i);
    case 'includes': case 'contains': return String(l).includes(String(i));
    case 'not_contains': return !String(l).includes(String(i));
    case 'count==': return countIn(String(i), l) === n;
    case 'count>=': return countIn(String(i), l) >= n;
    case 'count<': return countIn(String(i), l) < n;
    case 'percent==': return percentIn(String(i), l) === n;
    case 'percent>': return percentIn(String(i), l) > n;
    case 'percent<': return percentIn(String(i), l) < n;
    case 'empty': return l === '' || l == null;
    case 'not_empty': case 'filled': return !(l === '' || l == null);
    default: return false;
  }
}
// (cond E cond) OU (cond). Sem grupos: vale o padrão (true nas regras de exibição).
export function evalRoles(roles: unknown, vars: Vars, empty = true): boolean {
  const groups = Array.isArray(roles) ? roles.filter(g => Array.isArray(g) && g.length) as Roles : [];
  if (!groups.length) return empty;
  return groups.some(g => g.every(c => evalCond(c, vars)));
}
