import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SqlTemplates } from '../../src/utils/SqlTemplates';

describe('SqlTemplates', () => {
  let tmpDir: string;
  let sql: SqlTemplates;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-templates-'));
    sql = new SqlTemplates(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTemplate(name: string, content: string): void {
    fs.writeFileSync(path.join(tmpDir, `${name}.sql`), content);
  }

  describe('get', () => {
    it('should load a SQL template by name', () => {
      writeTemplate('test', 'SELECT 1');
      expect(sql.get('test')).toBe('SELECT 1');
    });

    it('should trim whitespace from loaded templates', () => {
      writeTemplate('test', '  SELECT 1  \n');
      expect(sql.get('test')).toBe('SELECT 1');
    });

    it('should throw for missing templates', () => {
      expect(() => sql.get('nonexistent')).toThrow('SQL template not found: nonexistent');
    });

    it('should substitute %s placeholders', () => {
      writeTemplate('query', "SELECT * FROM %s WHERE name = '%s'");
      expect(sql.get('query', 'users', 'Alice')).toBe("SELECT * FROM users WHERE name = 'Alice'");
    });

    it('should cache templates after first load', () => {
      writeTemplate('test', 'SELECT 1');
      sql.get('test');

      // Delete the file — cached version should still work
      fs.unlinkSync(path.join(tmpDir, 'test.sql'));
      expect(sql.get('test')).toBe('SELECT 1');
    });

    it('should return raw SQL when no args provided', () => {
      writeTemplate('test', 'SELECT %s FROM table');
      expect(sql.get('test')).toBe('SELECT %s FROM table');
    });
  });

  describe('getMetaData', () => {
    it('should use getMetaData template for PG 12+', () => {
      writeTemplate('getMetaData', 'SELECT * FROM meta WHERE graph = %s');
      const result = sql.getMetaData('test_graph', 15);
      expect(result).toBe('SELECT * FROM meta WHERE graph = test_graph');
    });

    it('should use getMetaDataLegacy template for PG 11', () => {
      writeTemplate('getMetaDataLegacy', 'SELECT * FROM legacy_meta WHERE graph = %s');
      const result = sql.getMetaData('test_graph', 11);
      expect(result).toBe('SELECT * FROM legacy_meta WHERE graph = test_graph');
    });

    it('should use legacy for PG versions below 11', () => {
      writeTemplate('getMetaDataLegacy', 'LEGACY %s');
      const result = sql.getMetaData('g', 10);
      expect(result).toBe('LEGACY g');
    });
  });

  describe('clearCache', () => {
    it('should clear the cache so templates are re-read', () => {
      writeTemplate('test', 'SELECT 1');
      expect(sql.get('test')).toBe('SELECT 1');

      // Update the file content
      writeTemplate('test', 'SELECT 2');
      sql.clearCache();
      expect(sql.get('test')).toBe('SELECT 2');
    });
  });

  describe('with real project SQL files', () => {
    let projectSql: SqlTemplates;

    beforeEach(() => {
      const sqlDir = path.join(__dirname, '../../sql');
      projectSql = new SqlTemplates(sqlDir);
    });

    it('should load getGraphNames template', () => {
      const template = projectSql.get('getGraphNames');
      expect(template).toBeTruthy();
      expect(template.length).toBeGreaterThan(0);
    });

    it('should load initAge template', () => {
      const template = projectSql.get('initAge');
      expect(template).toBeTruthy();
    });

    it('should load pgVersion template', () => {
      const template = projectSql.get('pgVersion');
      expect(template).toBeTruthy();
    });

    it('should load getMetaData template with substitution', () => {
      const template = projectSql.getMetaData('test_graph', 15);
      expect(template).toBeTruthy();
      expect(template).toContain('test_graph');
    });

    it('should load getMetaDataLegacy template with substitution', () => {
      const template = projectSql.getMetaData('test_graph', 11);
      expect(template).toBeTruthy();
      expect(template).toContain('test_graph');
    });
  });
});
