import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads SQL template files from the sql/ directory.
 * Inspired by AGE Viewer's SQLFlavorManager but simplified.
 */
export class SqlTemplates {
  private readonly cache = new Map<string, string>();

  constructor(private readonly sqlDir: string) {}

  /**
   * Get a SQL template by name, with optional format string substitution.
   *
   * @param name - Template name (without .sql extension)
   * @param args - Values to substitute for %s placeholders (util.format style)
   * @returns The SQL string with substitutions applied
   */
  get(name: string, ...args: string[]): string {
    let sql = this.cache.get(name);

    if (!sql) {
      const filePath = path.join(this.sqlDir, `${name}.sql`);
      if (!fs.existsSync(filePath)) {
        throw new Error(`SQL template not found: ${name}`);
      }
      sql = fs.readFileSync(filePath, 'utf-8').trim();
      this.cache.set(name, sql);
    }

    if (args.length > 0) {
      let result = sql;
      for (const arg of args) {
        result = result.replace('%s', arg);
      }
      return result;
    }

    return sql;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
