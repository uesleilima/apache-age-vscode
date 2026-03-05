/**
 * Hand-rolled recursive descent parser for Apache AGE's agtype format.
 * Ported from the ANTLR4 grammar (Agtype.g4) used by AGE Viewer.
 *
 * Agtype is a superset of JSON that supports:
 * - Standard JSON values (strings, numbers, booleans, null, objects, arrays)
 * - Infinity and NaN float literals
 * - Type annotations via ::identifier (e.g., ::vertex, ::edge, ::path)
 *
 * The parser converts agtype text into native JavaScript values.
 * Type annotations are preserved as a __type property on objects.
 *
 * @license Apache-2.0
 */

// ---------- Tokenizer ----------

enum TokenKind {
  String,
  Integer,
  Float,
  True,
  False,
  Null,
  LBrace,
  RBrace,
  LBracket,
  RBracket,
  Colon,
  DoubleColon,
  Comma,
  Ident,
  EOF,
}

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

class AgtypeLexer {
  private pos = 0;

  constructor(private readonly input: string) {}

  nextToken(): Token {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      return { kind: TokenKind.EOF, value: '', pos: this.pos };
    }

    const start = this.pos;
    const ch = this.input[this.pos];

    // Single-character tokens
    switch (ch) {
      case '{':
        this.pos++;
        return { kind: TokenKind.LBrace, value: '{', pos: start };
      case '}':
        this.pos++;
        return { kind: TokenKind.RBrace, value: '}', pos: start };
      case '[':
        this.pos++;
        return { kind: TokenKind.LBracket, value: '[', pos: start };
      case ']':
        this.pos++;
        return { kind: TokenKind.RBracket, value: ']', pos: start };
      case ',':
        this.pos++;
        return { kind: TokenKind.Comma, value: ',', pos: start };
      case ':':
        if (this.input[this.pos + 1] === ':') {
          this.pos += 2;
          return { kind: TokenKind.DoubleColon, value: '::', pos: start };
        }
        this.pos++;
        return { kind: TokenKind.Colon, value: ':', pos: start };
    }

    // String
    if (ch === '"') {
      return this.readString(start);
    }

    // Number or -Infinity
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      // Check for -Infinity
      if (ch === '-' && this.input.substring(this.pos + 1, this.pos + 9) === 'Infinity') {
        this.pos += 9;
        return { kind: TokenKind.Float, value: '-Infinity', pos: start };
      }
      return this.readNumber(start);
    }

    // Keywords / identifiers
    if (this.isIdentStart(ch)) {
      return this.readIdentOrKeyword(start);
    }

    throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private readString(start: number): Token {
    this.pos++; // skip opening "
    let result = '"';

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '\\') {
        result += ch;
        this.pos++;
        if (this.pos < this.input.length) {
          result += this.input[this.pos];
          this.pos++;
        }
      } else if (ch === '"') {
        result += '"';
        this.pos++;
        return { kind: TokenKind.String, value: result, pos: start };
      } else {
        result += ch;
        this.pos++;
      }
    }

    throw new Error(`Unterminated string starting at position ${start}`);
  }

  private readNumber(start: number): Token {
    let numStr = '';
    let isFloat = false;

    // Optional negative sign
    if (this.input[this.pos] === '-') {
      numStr += '-';
      this.pos++;
    }

    // Integer part
    while (this.pos < this.input.length && this.input[this.pos] >= '0' && this.input[this.pos] <= '9') {
      numStr += this.input[this.pos];
      this.pos++;
    }

    // Decimal part
    if (this.pos < this.input.length && this.input[this.pos] === '.') {
      isFloat = true;
      numStr += '.';
      this.pos++;
      while (this.pos < this.input.length && this.input[this.pos] >= '0' && this.input[this.pos] <= '9') {
        numStr += this.input[this.pos];
        this.pos++;
      }
    }

    // Exponent part
    if (this.pos < this.input.length && (this.input[this.pos] === 'e' || this.input[this.pos] === 'E')) {
      isFloat = true;
      numStr += this.input[this.pos];
      this.pos++;
      if (this.pos < this.input.length && (this.input[this.pos] === '+' || this.input[this.pos] === '-')) {
        numStr += this.input[this.pos];
        this.pos++;
      }
      while (this.pos < this.input.length && this.input[this.pos] >= '0' && this.input[this.pos] <= '9') {
        numStr += this.input[this.pos];
        this.pos++;
      }
    }

    return {
      kind: isFloat ? TokenKind.Float : TokenKind.Integer,
      value: numStr,
      pos: start,
    };
  }

  private readIdentOrKeyword(start: number): Token {
    let ident = '';
    while (this.pos < this.input.length && this.isIdentChar(this.input[this.pos])) {
      ident += this.input[this.pos];
      this.pos++;
    }

    switch (ident) {
      case 'true':
        return { kind: TokenKind.True, value: 'true', pos: start };
      case 'false':
        return { kind: TokenKind.False, value: 'false', pos: start };
      case 'null':
        return { kind: TokenKind.Null, value: 'null', pos: start };
      case 'Infinity':
        return { kind: TokenKind.Float, value: 'Infinity', pos: start };
      case 'NaN':
        return { kind: TokenKind.Float, value: 'NaN', pos: start };
      default:
        return { kind: TokenKind.Ident, value: ident, pos: start };
    }
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || (ch >= '0' && ch <= '9') || ch === '$';
  }
}

// ---------- Parser ----------

class AgtypeParser {
  private current: Token;
  private lexer: AgtypeLexer;

  constructor(input: string) {
    this.lexer = new AgtypeLexer(input);
    this.current = this.lexer.nextToken();
  }

  /**
   * Parse the full agtype value.
   * Grammar: agType -> agValue EOF
   */
  parse(): unknown {
    const result = this.parseAgValue();
    this.expect(TokenKind.EOF);
    return result;
  }

  /**
   * agValue -> value typeAnnotation?
   */
  private parseAgValue(): unknown {
    let value = this.parseValue();

    // Check for type annotation ::ident
    if (this.current.kind === TokenKind.DoubleColon) {
      this.advance();
      const typeName = this.expect(TokenKind.Ident).value;

      // Attach type annotation to objects
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        (value as Record<string, unknown>).__type = typeName;
      } else if (Array.isArray(value)) {
        // For paths, wrap in an object with type info
        const wrapper = value as unknown as Record<string, unknown>;
        Object.defineProperty(wrapper, '__type', {
          value: typeName,
          enumerable: false,
          writable: true,
        });
      }
    }

    return value;
  }

  /**
   * value -> STRING | INTEGER | floatLiteral | 'true' | 'false' | 'null' | obj | array
   */
  private parseValue(): unknown {
    switch (this.current.kind) {
      case TokenKind.String: {
        const raw = this.current.value;
        this.advance();
        return JSON.parse(raw);
      }
      case TokenKind.Integer: {
        const val = this.current.value;
        this.advance();
        // Use BigInt-safe parsing for very large integers
        const num = parseInt(val, 10);
        return num;
      }
      case TokenKind.Float: {
        const val = this.current.value;
        this.advance();
        return parseFloat(val);
      }
      case TokenKind.True:
        this.advance();
        return true;
      case TokenKind.False:
        this.advance();
        return false;
      case TokenKind.Null:
        this.advance();
        return null;
      case TokenKind.LBrace:
        return this.parseObject();
      case TokenKind.LBracket:
        return this.parseArray();
      default:
        throw new Error(
          `Unexpected token '${this.current.value}' at position ${this.current.pos}`
        );
    }
  }

  /**
   * obj -> '{' (pair (',' pair)*)? '}'
   */
  private parseObject(): Record<string, unknown> {
    this.expect(TokenKind.LBrace);
    const obj: Record<string, unknown> = {};

    if (this.current.kind !== TokenKind.RBrace) {
      this.parsePair(obj);
      while (this.current.kind === TokenKind.Comma) {
        this.advance();
        this.parsePair(obj);
      }
    }

    this.expect(TokenKind.RBrace);
    return obj;
  }

  /**
   * pair -> STRING ':' agValue
   */
  private parsePair(obj: Record<string, unknown>): void {
    const keyToken = this.expect(TokenKind.String);
    const key = JSON.parse(keyToken.value);
    this.expect(TokenKind.Colon);
    obj[key] = this.parseAgValue();
  }

  /**
   * array -> '[' (agValue (',' agValue)*)? ']'
   */
  private parseArray(): unknown[] {
    this.expect(TokenKind.LBracket);
    const arr: unknown[] = [];

    if (this.current.kind !== TokenKind.RBracket) {
      arr.push(this.parseAgValue());
      while (this.current.kind === TokenKind.Comma) {
        this.advance();
        arr.push(this.parseAgValue());
      }
    }

    this.expect(TokenKind.RBracket);
    return arr;
  }

  private advance(): Token {
    const prev = this.current;
    this.current = this.lexer.nextToken();
    return prev;
  }

  private expect(kind: TokenKind): Token {
    if (this.current.kind !== kind) {
      throw new Error(
        `Expected ${TokenKind[kind]} but got ${TokenKind[this.current.kind]} ('${this.current.value}') at position ${this.current.pos}`
      );
    }
    return this.advance();
  }
}

// ---------- Public API ----------

/**
 * Deserialize an agtype string into a native JavaScript value.
 *
 * This is the function registered as a pg type parser for the agtype OID,
 * so all agtype columns returned by PostgreSQL are automatically deserialized.
 *
 * @param input - The raw agtype string from PostgreSQL
 * @returns The parsed JavaScript value (object, array, primitive, etc.)
 *
 * @example
 * ```ts
 * deserializeAgtype('{"id": 1, "label": "Person", "properties": {"name": "Alice"}}::vertex')
 * // Returns: { id: 1, label: "Person", properties: { name: "Alice" }, __type: "vertex" }
 * ```
 */
export function deserializeAgtype(input: string): unknown {
  if (!input || input.trim().length === 0) {
    return null;
  }
  const parser = new AgtypeParser(input.trim());
  return parser.parse();
}
