// SPDX-License-Identifier: GPL-3.0-only
/**
 * Reader for the Lua table literals WoW writes to SavedVariables (`Name = { ["k"] = v, ... }`).
 * Data only, nothing is executed. Tolerant on purpose: the file can be cut off (client crash, disk full) or
 * hand-edited, so on a syntax error everything parsed up to that point is returned and `truncated` is set.
 */
export type LuaValue = string | number | boolean | null | LuaTable;
/** Array part and hash part are kept together; Lua tables have no other shape. */
export interface LuaTable {
  [key: string]: LuaValue;
}

export interface LuaFile {
  globals: Record<string, LuaValue>;
  /** True when the text ended or went wrong mid-way; `globals` holds what was readable. */
  truncated: boolean;
}

class Stop extends Error {}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };

class Reader {
  pos = 0;
  broken = false;
  constructor(private readonly src: string) {}

  private fail(): never { throw new Stop(); }

  skip(): void {
    const s = this.src;
    for (;;) {
      while (this.pos < s.length && /\s/.test(s[this.pos]!)) this.pos++;
      if (s.startsWith('--', this.pos)) {
        const long = /^--\[(=*)\[/.exec(s.slice(this.pos, this.pos + 40));
        if (long) {
          const end = s.indexOf(`]${long[1]}]`, this.pos);
          if (end < 0) { this.pos = s.length; this.fail(); }
          this.pos = end + long[1]!.length + 2;
        } else {
          const nl = s.indexOf('\n', this.pos);
          this.pos = nl < 0 ? s.length : nl + 1;
        }
        continue;
      }
      return;
    }
  }

  peek(): string | undefined { return this.src[this.pos]; }
  eof(): boolean { this.skip(); return this.pos >= this.src.length; }

  expect(ch: string): void {
    this.skip();
    if (this.src[this.pos] !== ch) this.fail();
    this.pos++;
  }

  ident(): string | undefined {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.pos, this.pos + 128));
    if (!m) return undefined;
    this.pos += m[0].length;
    return m[0];
  }

  string(): string {
    const s = this.src;
    const q = s[this.pos++]!;
    let out = '';
    for (;;) {
      if (this.pos >= s.length) this.fail();
      const c = s[this.pos++]!;
      if (c === q) return out;
      if (c === '\n') this.fail();
      if (c !== '\\') { out += c; continue; }
      const e = s[this.pos++];
      if (e === undefined) this.fail();
      if (e in ESCAPES) { out += ESCAPES[e]; continue; }
      if (e === 'x') {
        const h = /^[0-9a-fA-F]{2}/.exec(s.slice(this.pos, this.pos + 2));
        if (!h) this.fail();
        out += String.fromCharCode(parseInt(h[0], 16));
        this.pos += 2;
      } else if (/[0-9]/.test(e)) {
        const d = /^\d{1,3}/.exec(s.slice(this.pos - 1, this.pos + 2))![0];
        this.pos += d.length - 1;
        out += String.fromCharCode(Number(d));
      } else if (e === 'z') {
        while (this.pos < s.length && /\s/.test(s[this.pos]!)) this.pos++;
      } else this.fail();
    }
  }

  /** `[[long]]` / `[==[long]==]` strings. */
  longString(): string {
    const m = /^\[(=*)\[/.exec(this.src.slice(this.pos, this.pos + 40));
    if (!m) this.fail();
    const close = `]${m[1]}]`;
    const end = this.src.indexOf(close, this.pos + m[0].length);
    if (end < 0) this.fail();
    let body = this.src.slice(this.pos + m[0].length, end);
    if (body.startsWith('\r\n')) body = body.slice(2); else if (body.startsWith('\n')) body = body.slice(1);
    this.pos = end + close.length;
    return body;
  }

  number(): number {
    const m = /^-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(this.src.slice(this.pos, this.pos + 64));
    if (!m) this.fail();
    this.pos += m[0].length;
    const n = Number(m[0]);
    if (Number.isNaN(n)) this.fail();
    return n;
  }

  value(): LuaValue {
    this.skip();
    const c = this.peek();
    if (c === '{') return this.table();
    if (c === '"' || c === "'") return this.string();
    if (c === '[') return this.longString();
    if (c !== undefined && (c === '-' || c === '.' || /[0-9]/.test(c))) return this.number();
    const id = this.ident();
    if (id === 'true') return true;
    if (id === 'false') return false;
    if (id === 'nil') return null;
    // `math.huge`-style values never appear in SavedVariables; anything else is a syntax error.
    return this.fail();
  }

  /** On a syntax error the entries read so far are kept and every enclosing table stops too. */
  table(): LuaTable {
    const t: LuaTable = {};
    let n = 0;
    this.pos++; // {
    try {
      for (;;) {
        this.skip();
        const c = this.peek();
        if (c === '}') { this.pos++; return t; }
        if (c === undefined) this.fail();
        if (c === '[' && !/^\[=*\[/.test(this.src.slice(this.pos, this.pos + 40))) {
          this.pos++;
          const k = this.value();
          this.expect(']');
          this.expect('=');
          const v = this.value();
          if (k !== null && typeof k !== 'object') t[String(k)] = v;
        } else {
          const save = this.pos;
          const id = /[A-Za-z_]/.test(c) ? this.ident() : undefined;
          this.skip();
          if (id && this.peek() === '=' && this.src[this.pos + 1] !== '=') {
            this.pos++;
            t[id] = this.value();
          } else {
            this.pos = save;
            t[String(++n)] = this.value();
          }
        }
        this.skip();
        const sep = this.peek();
        if (sep === ',' || sep === ';') this.pos++;
        else if (sep !== '}') this.fail();
      }
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
      this.broken = true;
      this.pos = this.src.length;
      return t;
    }
  }
}

/** Parses `Name = value` assignments at the top level of a SavedVariables file. */
export function parseLuaFile(text: string): LuaFile {
  const r = new Reader(text.replace(/^﻿/, ''));
  const globals: Record<string, LuaValue> = {};
  let truncated = false;
  try {
    while (!r.eof()) {
      const name = r.ident();
      if (!name) throw new Stop();
      r.expect('=');
      globals[name] = r.value();
      if (r.broken) { truncated = true; break; }
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    truncated = true;
  }
  return { globals, truncated: truncated || r.broken };
}

/** Elements 1..n of a table written as a Lua array, in order (skips holes). */
export function luaArray(v: LuaValue | undefined): LuaValue[] {
  if (!v || typeof v !== 'object') return [];
  const out: LuaValue[] = [];
  for (let i = 1; String(i) in v; i++) out.push(v[String(i)]!);
  return out;
}
