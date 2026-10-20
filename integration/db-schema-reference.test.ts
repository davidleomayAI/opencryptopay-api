import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import ts from 'typescript';
import {
  GENERATED_HEADER,
  REPO_ROOT,
  TABLE_TYPES,
  baseKind,
  buildSchemaModel,
  camelCase,
  cardinality,
  columnKind,
  compareToCommitted,
  createProgram,
  enumColumnsOf,
  generate,
  readCommitted,
  readRawSchema,
  renderDefault,
  renderPages,
  resolveEnumColumns,
} from './db-schema-reference';
import type { RawTable, SchemaModel, TableType } from './db-schema-reference';

const VIRTUAL_FILE = '/virtual/types.ts';

const VIRTUAL_SOURCE = [
  "export type Mode = 'a' | 'b';",
  "export enum Level { Low = 'low', High = 'high' }",
  'export type Row = {',
  '  id: string;',
  '  mode: Mode;',
  '  maybeMode: Mode | null;',
  '  optionalMode?: Mode;',
  '  level: Level;',
  '  flag: boolean;',
  '  label: string;',
  '  count: number;',
  '  digit: 1 | 2;',
  '  other: Mode | string;',
  '  nested: { x: 1 };',
  '  created_at: string;',
  '};',
  "export interface Entity { kind: 'x' | 'y'; name: string }",
].join('\n');

const ROW_COLUMNS = [
  'id',
  'mode',
  'maybe_mode',
  'optional_mode',
  'level',
  'flag',
  'label',
  'count',
  'digit',
  'other',
  'nested',
  'missing_column',
] as const;

const ENUM_ROW = ['digit', 'level', 'maybe_mode', 'mode', 'optional_mode'];

const DDL = [
  'CREATE TABLE parent (',
  '  id INTEGER PRIMARY KEY,',
  '  code TEXT NOT NULL UNIQUE,',
  "  note TEXT DEFAULT 'none'",
  ');',
  'CREATE TABLE child (',
  '  parent_id INTEGER NOT NULL,',
  '  tag TEXT NOT NULL,',
  '  PRIMARY KEY (parent_id, tag),',
  '  FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE',
  ');',
  'CREATE TABLE solo (',
  '  id TEXT PRIMARY KEY,',
  '  parent_id INTEGER UNIQUE REFERENCES parent,',
  '  weight REAL',
  ');',
  "CREATE INDEX child_tag ON child(tag) WHERE tag <> 'x';",
].join('\n');

const LONER_DDL = 'CREATE TABLE loner (id TEXT PRIMARY KEY);';

function sortedSet(values: ReadonlySet<string>): string[] {
  return [...values].sort();
}

function bareTable(name: string, columns: readonly string[]): RawTable {
  return {
    name,
    columns: columns.map((column, cid) => ({
      cid,
      name: column,
      type: 'TEXT',
      notNull: false,
      defaultValue: null,
      primaryKeyPosition: 0,
      hidden: 0,
    })),
    foreignKeys: [],
    indexes: [],
  };
}

function virtualProgram(source: string): ts.Program {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile;
  const originalFileExists = host.fileExists;
  const originalReadFile = host.readFile;
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === VIRTUAL_FILE) {
      return ts.createSourceFile(fileName, source, languageVersion, true);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (fileName) => fileName === VIRTUAL_FILE || originalFileExists(fileName);
  host.readFile = (fileName) => (fileName === VIRTUAL_FILE ? source : originalReadFile(fileName));
  return ts.createProgram([VIRTUAL_FILE], options, host);
}

function openSchema(extra = ''): Database {
  const db = new Database(':memory:');
  db.exec(DDL + extra);
  return db;
}

function requireTable(tables: readonly RawTable[], name: string): RawTable {
  const found = tables.find((table) => table.name === name);
  if (found === undefined) {
    throw new Error(name);
  }
  return found;
}

function modelOf(
  tables: readonly RawTable[],
  enumColumns: ReadonlyMap<string, ReadonlySet<string>>,
): SchemaModel {
  return buildSchemaModel(tables, enumColumns);
}

function tableModel(model: SchemaModel, name: string): SchemaModel['tables'][number] {
  const found = model.tables.find((table) => table.name === name);
  if (found === undefined) {
    throw new Error(name);
  }
  return found;
}

function columnModel(
  model: SchemaModel,
  table: string,
  column: string,
): SchemaModel['tables'][number]['columns'][number] {
  const found = tableModel(model, table).columns.find((item) => item.name === column);
  if (found === undefined) {
    throw new Error(`${table}.${column}`);
  }
  return found;
}

function reversedTables(tables: readonly RawTable[]): RawTable[] {
  return [...tables].reverse().map((table) => ({
    ...table,
    columns: [...table.columns].reverse(),
    foreignKeys: [...table.foreignKeys].reverse(),
    indexes: [...table.indexes].reverse(),
  }));
}

describe('docs/database', () => {
  test('docs/database matches the boot schema', async () => {
    const rendered = await generate(REPO_ROOT);
    const committed = await readCommitted(REPO_ROOT);
    const diff = compareToCommitted(rendered, committed);
    const lines = [
      ...diff.missing.map((file) => `missing: ${file}`),
      ...diff.differing.map((file) => `differs: ${file}`),
      ...diff.stale.map((file) => `stale: ${file}`),
    ];
    if (lines.length > 0) {
      lines.push('Run: bun run db:docs');
    }
    expect(lines).toEqual([]);
  }, 120_000);
});

describe('baseKind / columnKind / camelCase / renderDefault / cardinality / compareToCommitted', () => {
  test('baseKind maps every declared-type family', () => {
    expect(baseKind('integer')).toBe('Integer');
    expect(baseKind('INTEGER')).toBe('Integer');
    expect(baseKind('INT')).toBe('Integer');
    expect(baseKind('BIGINT')).toBe('Integer');
    expect(baseKind('VARYING CHARACTER(10)')).toBe('Free text');
    expect(baseKind('NATIVE CHARACTER(70)')).toBe('Free text');
    expect(baseKind('DOUBLE PRECISION')).toBe('Decimal');
    expect(baseKind('REAL')).toBe('Decimal');
    expect(baseKind('DOUBLE PRECISION')).toBe('Decimal');
    expect(baseKind('FLOAT')).toBe('Decimal');
    expect(baseKind('NUMERIC')).toBe('Decimal');
    expect(baseKind('DECIMAL')).toBe('Decimal');
    expect(baseKind('TEXT')).toBe('Free text');
    expect(baseKind('varchar(32)')).toBe('Free text');
    expect(baseKind('CHAR')).toBe('Free text');
    expect(baseKind('CLOB')).toBe('Free text');
    expect(baseKind('BLOB')).toBe('Binary');
    expect(baseKind('BOOLEAN')).toBe('Boolean');
    expect(baseKind('DATE')).toBe('Date/time');
    expect(baseKind('datetime')).toBe('Date/time');
    expect(baseKind('TIMESTAMP')).toBe('Date/time');
    expect(baseKind('JSON')).toBe('JSON');
    expect(baseKind('')).toBe('');
  });

  test('columnKind covers primary key, auto-increment, foreign key, enum, and plain', () => {
    expect(
      columnKind({
        base: 'Integer',
        isEnum: false,
        isPrimaryKey: true,
        isAutoIncrement: true,
        isForeignKey: false,
      }),
    ).toBe('Integer (primary key, auto-increment)');
    expect(
      columnKind({
        base: 'Integer',
        isEnum: false,
        isPrimaryKey: true,
        isAutoIncrement: false,
        isForeignKey: true,
      }),
    ).toBe('Integer (primary key)');
    expect(
      columnKind({
        base: 'Free text',
        isEnum: false,
        isPrimaryKey: true,
        isAutoIncrement: false,
        isForeignKey: false,
      }),
    ).toBe('Free text (primary key)');
    expect(
      columnKind({
        base: 'Integer',
        isEnum: false,
        isPrimaryKey: false,
        isAutoIncrement: false,
        isForeignKey: true,
      }),
    ).toBe('Integer (foreign key)');
    expect(
      columnKind({
        base: 'Free text',
        isEnum: true,
        isPrimaryKey: false,
        isAutoIncrement: false,
        isForeignKey: false,
      }),
    ).toBe('ENUM');
    expect(
      columnKind({
        base: 'Decimal',
        isEnum: false,
        isPrimaryKey: false,
        isAutoIncrement: false,
        isForeignKey: false,
      }),
    ).toBe('Decimal');
  });

  test('camelCase converts snake_case and leaves a single word', () => {
    expect(camelCase('shop_type')).toBe('shopType');
    expect(camelCase('id')).toBe('id');
    expect(camelCase('last_transaction_at')).toBe('lastTransactionAt');
  });

  test('renderDefault formats null, strings, numbers, and keywords', () => {
    expect(renderDefault(null)).toBe('–');
    expect(renderDefault("'none'")).toBe('`none`');
    expect(renderDefault('0')).toBe('`0`');
    expect(renderDefault('CURRENT_TIMESTAMP')).toBe('`CURRENT_TIMESTAMP`');
    expect(renderDefault("''")).toBe("`''`");
  });

  test('covers every nullability and uniqueness pair', () => {
    expect(cardinality(true, false, false)).toBe('}o..o|');
    expect(cardinality(false, false, false)).toBe('}o..||');
    expect(cardinality(true, true, false)).toBe('|o..o|');
    expect(cardinality(false, true, false)).toBe('|o..||');
    expect(cardinality(false, false, true)).toBe('}o--||');
    expect(cardinality(false, true, true)).toBe('|o--||');
  });

  test('reports missing, differing, and stale paths in sorted order', () => {
    const rendered = new Map<string, string>([
      ['z.md', 'only rendered'],
      ['m.md', 'changed'],
      ['a.md', 'same'],
      ['b.md', 'also missing'],
    ]);
    const committed = new Map<string, string>([
      ['m.md', 'original'],
      ['a.md', 'same'],
      ['s.md', 'only committed'],
      ['c.md', 'also stale'],
    ]);
    expect(compareToCommitted(rendered, committed)).toEqual({
      missing: ['b.md', 'z.md'],
      differing: ['m.md'],
      stale: ['c.md', 's.md'],
    });
  });
});

describe('enum detection', () => {
  test('enumColumnsOf keeps literal unions and enums, including null and optional', () => {
    const program = virtualProgram(VIRTUAL_SOURCE);
    const row = enumColumnsOf(program, VIRTUAL_FILE, 'Row', ROW_COLUMNS);
    expect(sortedSet(row)).toEqual(ENUM_ROW);
    const entity = enumColumnsOf(program, VIRTUAL_FILE, 'Entity', ['kind', 'name']);
    expect(sortedSet(entity)).toEqual(['kind']);
  });

  test('enumColumnsOf throws for an unknown type and an unknown file', () => {
    const program = virtualProgram(VIRTUAL_SOURCE);
    expect(() => enumColumnsOf(program, VIRTUAL_FILE, 'Missing', ['id'])).toThrow();
    expect(() => enumColumnsOf(program, '/virtual/missing.ts', 'Row', ['id'])).toThrow();
  });

  test('resolveEnumColumns honours injected table types', () => {
    const program = virtualProgram(VIRTUAL_SOURCE);
    const parent = bareTable('parent', ROW_COLUMNS);
    const plain = bareTable('plain', ['id']);
    const tableTypes: Readonly<Record<string, TableType | null>> = {
      parent: { file: 'types.ts', typeName: 'Row' },
      plain: null,
    };
    const resolved = resolveEnumColumns(program, '/virtual', [parent, plain], tableTypes);
    expect(sortedSet(resolved.get('parent') ?? new Set())).toEqual(ENUM_ROW);
    expect(resolved.get('plain')).toEqual(new Set());
    const ghost = bareTable('ghost', ['id']);
    expect(() => resolveEnumColumns(program, '/virtual', [ghost], tableTypes)).toThrow(
      'Table "ghost" has no entry in TABLE_TYPES',
    );
  });

  test('TABLE_TYPES matches the live StoredMapPlace columns', () => {
    expect(Object.keys(TABLE_TYPES).sort()).toEqual([
      'map_place',
      'map_place_payment_day',
      'map_place_support',
    ]);
    const program = createProgram(REPO_ROOT);
    const found = enumColumnsOf(
      program,
      path.join(REPO_ROOT, 'src/lib/map/place.ts'),
      'StoredMapPlace',
      ['id', 'origin', 'shop_type', 'activity', 'category', 'tech_provider', 'lat'],
    );
    expect(sortedSet(found)).toEqual(['activity', 'shop_type']);
  }, 60_000);
});

describe('readRawSchema', () => {
  test('reads tables, keys, defaults, and partial indexes', () => {
    const db = new Database(':memory:');
    db.exec(DDL);
    const tables = readRawSchema(db);
    expect(tables.map((table) => table.name).sort()).toEqual(['child', 'parent', 'solo']);

    const parent = requireTable(tables, 'parent');
    const parentId = parent.columns.find((column) => column.name === 'id');
    expect(parentId?.primaryKeyPosition).toBe(1);
    expect(parentId?.type).toBe('INTEGER');
    const note = parent.columns.find((column) => column.name === 'note');
    expect(note?.defaultValue).toBe("'none'");
    const parentUnique = parent.indexes.find(
      (index) => index.origin === 'u' && index.columns.join() === 'code',
    );
    expect(parentUnique?.columns).toEqual(['code']);

    const child = requireTable(tables, 'child');
    const childFk = child.foreignKeys.find((fk) => fk.from === 'parent_id');
    expect(childFk?.refTable).toBe('parent');
    expect(childFk?.from).toBe('parent_id');
    expect(childFk?.to).toBe('id');
    const partial = child.indexes.find((index) => index.columns.join() === 'tag');
    expect(partial?.partial).toBe(true);
    expect(partial?.origin).toBe('c');
    const childPk = child.indexes.find((index) => index.origin === 'pk');
    expect(childPk?.columns).toEqual(['parent_id', 'tag']);

    const solo = requireTable(tables, 'solo');
    const soloFk = solo.foreignKeys.find((fk) => fk.from === 'parent_id');
    expect(soloFk?.to).toBeNull();
    expect(soloFk?.refTable).toBe('parent');

    const model = modelOf(tables, new Map());
    expect(columnModel(model, 'parent', 'id').kind).toBe('Integer (primary key, auto-increment)');
    const childParent = columnModel(model, 'child', 'parent_id');
    expect(childParent.kind).toBe('Integer (primary key)');
    expect(childParent.references).toEqual({ table: 'parent', column: 'id' });
    expect(columnModel(model, 'solo', 'id').kind).toBe('Free text (primary key)');
    const soloParent = columnModel(model, 'solo', 'parent_id');
    expect(soloParent.kind).toBe('Integer (foreign key)');
    expect(soloParent.references).toEqual({ table: 'parent', column: 'id' });
    expect(columnModel(model, 'solo', 'weight').kind).toBe('Decimal');
    expect(columnModel(model, 'parent', 'note').defaultText).toBe('`none`');

    const childRelation = tableModel(model, 'child').foreignKeys.find(
      (fk) => fk.column === 'parent_id',
    );
    expect(childRelation?.unique).toBe(false);
    expect(childRelation?.nullable).toBe(false);
    const soloRelation = tableModel(model, 'solo').foreignKeys.find(
      (fk) => fk.column === 'parent_id',
    );
    expect(soloRelation?.unique).toBe(true);
    expect(soloRelation?.nullable).toBe(true);

    db.close();
  });

  test('models a composite foreign key as one constraint', async () => {
    const db = openSchema(
      [
        'CREATE TABLE pair (a INTEGER NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a, b));',
        'CREATE TABLE pair_ref (a INTEGER NOT NULL, b TEXT NOT NULL, UNIQUE (b, a),',
        '  FOREIGN KEY (a, b) REFERENCES pair (a, b));',
        'CREATE TABLE pair_log (a INTEGER, b TEXT NOT NULL, FOREIGN KEY (a, b) REFERENCES pair (a, b));',
      ].join('\n'),
    );
    const model = modelOf(readRawSchema(db), new Map());
    db.close();
    expect(tableModel(model, 'pair_ref').foreignKeys.every((fk) => fk.unique)).toBe(true);
    expect(tableModel(model, 'pair_log').foreignKeys.some((fk) => fk.unique)).toBe(false);
    const pages = await renderPages(model, new Map(), REPO_ROOT);
    const edges = (name: string): string[] =>
      (pages.get(`docs/database/tables/${name}.md`) ?? '')
        .split('\n')
        .filter((line) => line.includes(`"${name}" `));
    expect(edges('pair_ref')).toEqual(['    "pair_ref" |o..|| "pair" : "a, b"']);
    expect(edges('pair_log')).toEqual(['    "pair_log" }o..o| "pair" : "a, b"']);
    expect(pages.get('docs/database/README.md')).toContain('- Foreign keys: 4');
  });

  test('labels a composite foreign key in its declared column order', async () => {
    const db = openSchema(
      [
        'CREATE TABLE zpair (z TEXT NOT NULL, a TEXT NOT NULL, PRIMARY KEY (z, a));',
        'CREATE TABLE zpair_ref (z TEXT NOT NULL, a TEXT NOT NULL,',
        '  FOREIGN KEY (z, a) REFERENCES zpair (z, a));',
      ].join('\n'),
    );
    const model = modelOf(readRawSchema(db), new Map());
    db.close();
    const pages = await renderPages(model, new Map(), REPO_ROOT);
    expect(pages.get('docs/database/tables/zpair_ref.md')).toContain(
      '"zpair_ref" }o..|| "zpair" : "z, a"',
    );
  });

  test('treats only a rowid table INTEGER PRIMARY KEY as the rowid', () => {
    const db = openSchema(
      [
        'CREATE TABLE descending (id INTEGER PRIMARY KEY DESC, note TEXT);',
        'CREATE TABLE no_rowid (id INTEGER PRIMARY KEY, note TEXT) WITHOUT ROWID;',
        'CREATE TABLE rowid_alias (id INTEGER PRIMARY KEY, note TEXT);',
      ].join('\n'),
    );
    const model = modelOf(readRawSchema(db), new Map());
    db.close();
    const key = (name: string) =>
      tableModel(model, name).columns.find((column) => column.name === 'id');
    expect(key('rowid_alias')?.kind).toContain('auto-increment');
    expect(key('rowid_alias')?.nullable).toBe(false);
    expect(key('descending')?.kind).not.toContain('auto-increment');
    expect(key('no_rowid')?.kind).not.toContain('auto-increment');
  });

  test('an index with an unnamed term never matches a column of the same label', () => {
    const db = openSchema(
      [
        'CREATE TABLE quoted ("(expression)" TEXT REFERENCES parent (code));',
        'CREATE UNIQUE INDEX quoted_lower ON quoted (lower("(expression)"));',
      ].join('\n'),
    );
    const model = modelOf(readRawSchema(db), new Map());
    db.close();
    expect(tableModel(model, 'quoted').foreignKeys[0]?.unique).toBe(false);
  });

  test('keeps an expression term in a unique index, so it does not make a foreign key unique', () => {
    const db = openSchema(
      [
        'CREATE TABLE tagged (parent_id INTEGER REFERENCES parent (id), tag TEXT);',
        'CREATE UNIQUE INDEX tagged_parent_tag ON tagged (parent_id, lower(tag));',
      ].join('\n'),
    );
    const model = modelOf(readRawSchema(db), new Map());
    db.close();
    const table = tableModel(model, 'tagged');
    expect(table.indexes.find((index) => index.name === 'tagged_parent_tag')?.columns).toEqual([
      'parent_id',
      '(expression)',
    ]);
    expect(table.foreignKeys[0]?.unique).toBe(false);
  });

  test('treats a foreign key that is the sole INTEGER PRIMARY KEY as one-to-one', () => {
    const db = openSchema('CREATE TABLE extension (id INTEGER PRIMARY KEY REFERENCES parent(id));');
    const model = modelOf(readRawSchema(db), new Map());
    db.close();
    const relation = tableModel(model, 'extension').foreignKeys.find((fk) => fk.column === 'id');
    expect(relation?.unique).toBe(true);
    expect(relation?.identifying).toBe(true);
    expect(relation?.nullable).toBe(false);
    expect(tableModel(model, 'extension').columns[0]?.nullable).toBe(false);
  });
});

describe('renderPages', () => {
  test('renders counts, kinds, cardinality, and stable pages', async () => {
    const db = openSchema();
    const tables = readRawSchema(db);
    db.close();
    const enums = new Map<string, ReadonlySet<string>>([['parent', new Set(['code'])]]);
    const sources = new Map<string, string[]>();
    const pages = await renderPages(modelOf(tables, enums), sources, REPO_ROOT);
    const readme = pages.get('docs/database/README.md');
    expect(readme).toContain('# Database schema');
    expect(readme).toContain('- Tables: 3');
    expect(readme).toContain('- Columns: 8');
    expect(readme).toContain('- Foreign keys: 2');
    for (const page of pages.values()) {
      expect(page.startsWith(GENERATED_HEADER)).toBe(true);
    }
    const parentPage = pages.get('docs/database/tables/parent.md');
    expect(parentPage).toContain('ENUM');
    expect(parentPage).toContain('## Indexes');
    expect(parentPage).toContain('## Referenced by');
    expect(parentPage).toContain('## Relations');
    expect(pages.get('docs/database/tables/child.md')).toContain('}o--||');
    expect(pages.get('docs/database/tables/solo.md')).toContain('|o..o|');

    const again = await renderPages(modelOf(tables, enums), sources, REPO_ROOT);
    expect(again).toEqual(pages);
    const shuffled = await renderPages(modelOf(reversedTables(tables), enums), sources, REPO_ROOT);
    expect(shuffled).toEqual(pages);

    const withLoner = openSchema(LONER_DDL);
    const four = readRawSchema(withLoner);
    withLoner.close();
    const fourPages = await renderPages(modelOf(four, enums), sources, REPO_ROOT);
    expect(fourPages.get('docs/database/tables/loner.md')).not.toContain('## Relations');
    for (const page of fourPages.values()) {
      expect(page.startsWith(GENERATED_HEADER)).toBe(true);
    }
  });
});

describe('generate', () => {
  test('writes one page per boot table and stays deterministic', async () => {
    const first = await generate(REPO_ROOT);
    expect([...first.keys()].sort()).toEqual(
      [
        'docs/database/README.md',
        'docs/database/tables/map_place.md',
        'docs/database/tables/map_place_payment_day.md',
        'docs/database/tables/map_place_support.md',
      ].sort(),
    );
    const support = first.get('docs/database/tables/map_place_support.md');
    expect(support).toContain('place_id');
    expect(support).toContain('map_place');
    const place = first.get('docs/database/tables/map_place.md');
    expect(place).toContain('ENUM');
    expect(place).not.toContain('SPAR');
    expect(place).not.toContain('within7Days');
    const second = await generate(REPO_ROOT);
    expect(second).toEqual(first);
  }, 120_000);
});
