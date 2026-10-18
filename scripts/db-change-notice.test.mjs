#!/usr/bin/env node
/**
 * Tests for the database-change notice check. No extra packages.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MARKER, evaluate, isMarkerVisible, visibleBody } from './db-change-notice.mjs';

const PLAIN_MARKER = MARKER.replaceAll('\uFE0F', '');

/**
 * Build a one-file pull-request list.
 * @param {string} filename
 * @param {string | undefined} patch Omit the patch when `patch` is `undefined`.
 * @param {string | undefined} content Omit the content when `content` is `undefined`.
 * @returns {Array<{ filename: string, status: string, patch?: string, content?: string }>}
 */
function files(filename, patch, content) {
  /** @type {{ filename: string, status: string, patch?: string, content?: string }} */
  const entry = { filename, status: 'modified' };
  if (patch !== undefined) entry.patch = patch;
  if (content !== undefined) entry.content = content;
  return [entry];
}

/**
 * Unified diff whose only changed content line is `line`.
 * @param {string} line
 * @returns {string}
 */
function diffWith(line) {
  return `--- a/src/lib/map/place.ts\n+++ b/src/lib/map/place.ts\n${line}\n`;
}

describe('path triggers', () => {
  it('triggers for docs/schema, docs/database, integration, sqlite.ts, and store.ts', () => {
    const names = [
      'docs/schema/map-place.sql',
      'docs/database/README.md',
      'integration/db-schema-reference.test.ts',
      'src/lib/map/sqlite.ts',
      'src/lib/map/store.ts',
    ];
    for (const filename of names) {
      const result = evaluate({
        body: '',
        files: files(filename, diffWith('+export const n = 1;')),
      });
      assert.deepEqual(result.triggers, [filename]);
      assert.equal(result.required, true);
      assert.equal(result.ok, false);
    }
  });

  it('keeps the first filename order and drops duplicates', () => {
    const result = evaluate({
      body: MARKER,
      files: [
        ...files('docs/schema/map-place.sql', ''),
        ...files('README.md', diffWith('+db.query(1);')),
        ...files('docs/schema/map-place.sql', ''),
        ...files('integration/run.ts'),
      ],
    });
    assert.deepEqual(result.triggers, ['docs/schema/map-place.sql', 'integration/run.ts']);
    assert.equal(result.ok, true);
  });
});

describe('patch triggers under src', () => {
  /** @type {Array<[string, string]>} */
  const patterns = [
    ['MAP_PLACE_SCHEMA_SQL', '+const q = MAP_PLACE_SCHEMA_SQL;'],
    ['SqliteMapPlaceStore', '+const store = new SqliteMapPlaceStore(dbPath);'],
    ['PLACE_DB', '+const path = PLACE_DB;'],
    ['.exec(', "+db.exec('PRAGMA foreign_keys = ON');"],
    ['.query(', '+db.query(text);'],
    ['.prepare(', '+db.prepare(text);'],
    ['.run(', '+db.run(text);'],
    ['new Database(', '+const db = new Database(path);'],
    ['PRAGMA', '+const p = "PRAGMA table_info(map_place)";'],
    ['lowercase pragma', '+const p = "pragma table_info(map_place)";'],
    ['SELECT FROM', '+const q = "select id from map_place";'],
    ['INSERT INTO', '+const q = "INSERT INTO map_place values (1)";'],
    ['UPDATE SET', '+const q = "UPDATE map_place SET name = 1";'],
    ['DELETE FROM', '+const q = "delete from map_place";'],
    ['CREATE INDEX', '+const q = "CREATE INDEX map_place_idx ON map_place (id)";'],
    ['CREATE UNIQUE INDEX', '+const q = "create unique index map_place_idx on map_place (id)";'],
    ['CREATE TABLE', '+const q = "CREATE TABLE map_place (id int)";'],
    ['ALTER TABLE', '+const q = "alter table map_place add column n int";'],
    ['DROP TABLE', '+const q = "DROP TABLE map_place";'],
    ['DROP INDEX', '+const q = "drop index map_place_idx";'],
    ['ON CONFLICT', '+const q = "ON CONFLICT DO NOTHING";'],
    ['removed line', '-db.query(text);'],
  ];

  for (const [name, line] of patterns) {
    it(`triggers on ${name}`, () => {
      const result = evaluate({
        body: '',
        files: files('src/lib/map/place.ts', diffWith(line)),
      });
      assert.deepEqual(result.triggers, ['src/lib/map/place.ts']);
      assert.equal(result.required, true);
      assert.equal(result.ok, false);
    });
  }

  it('triggers when src/index.ts constructs a SqliteMapPlaceStore', () => {
    const result = evaluate({
      body: '',
      files: files('src/index.ts', diffWith('+const store = new SqliteMapPlaceStore(dbPath);')),
    });
    assert.deepEqual(result.triggers, ['src/index.ts']);
  });

  it('does not trigger on the removed patterns', () => {
    for (const line of [
      '+await migrateUserSchema();',
      '+const q = sql`select 1`;',
      '+await sql.unsafe(text);',
    ]) {
      const result = evaluate({
        body: '',
        files: files('src/lib/map/place.ts', diffWith(line)),
      });
      assert.deepEqual(result.triggers, []);
      assert.equal(result.ok, true);
    }
  });

  it('fail-closes when a src TypeScript patch is missing or empty', () => {
    for (const patch of [undefined, '']) {
      const result = evaluate({ body: '', files: files('src/lib/map/place.ts', patch) });
      assert.deepEqual(result.triggers, ['src/lib/map/place.ts']);
      assert.equal(result.ok, false);
    }
  });
});

describe('file content triggers under src', () => {
  it('triggers when the file imports bun:sqlite but the patch line is plain text', () => {
    const result = evaluate({
      body: '',
      files: files(
        'src/lib/map/place.ts',
        diffWith('+export const description = "changed";'),
        "import Database from 'bun:sqlite';\nexport const description = 'changed';\n",
      ),
    });
    assert.deepEqual(result.triggers, ['src/lib/map/place.ts']);
    assert.equal(result.required, true);
    assert.equal(result.ok, false);
  });

  it('does not trigger when the file and patch have no database access', () => {
    const result = evaluate({
      body: '',
      files: files(
        'src/lib/map/place.ts',
        diffWith('+export const description = "changed";'),
        "export const description = 'changed';\n",
      ),
    });
    assert.deepEqual(result, { required: false, ok: true, triggers: [] });
  });

  it('counts database access in removed-file content from the base', () => {
    const result = evaluate({
      body: '',
      files: [
        {
          filename: 'src/lib/map/legacy.ts',
          status: 'removed',
          patch: diffWith('-export const description = "old";'),
          content: "import Database from 'bun:sqlite';\nexport const description = 'old';\n",
        },
      ],
    });
    assert.deepEqual(result.triggers, ['src/lib/map/legacy.ts']);
    assert.equal(result.required, true);
  });

  it('recognizes OpenCryptoPay database identifiers in complete files', () => {
    for (const content of [
      'const store = new SqliteMapPlaceStore(path);',
      'const path = PLACE_DB;',
      'const schema = MAP_PLACE_SCHEMA_SQL;',
    ]) {
      const result = evaluate({
        body: '',
        files: files('src/lib/map/place.ts', diffWith('+export const n = 1;'), content),
      });
      assert.deepEqual(result.triggers, ['src/lib/map/place.ts']);
    }
  });
});

describe('non-triggers', () => {
  it('ignores SQL under src/__tests__', () => {
    for (const filename of ['src/__tests__/place.test.ts', 'src/lib/map/__tests__/place.test.ts']) {
      const result = evaluate({
        body: '',
        files: files(filename, diffWith('+const q = "SELECT id FROM map_place";')),
      });
      assert.deepEqual(result.triggers, []);
      assert.equal(result.required, false);
      assert.equal(result.ok, true);
    }
  });

  it('ignores a TypeScript edit that does not touch the database', () => {
    const result = evaluate({
      body: '',
      files: files('src/lib/map/place.ts', diffWith('+export const n = 1;')),
    });
    assert.deepEqual(result, { required: false, ok: true, triggers: [] });
  });

  it('ignores a non-src file even when the patch contains SQL', () => {
    const result = evaluate({
      body: undefined,
      files: files('README.md', diffWith('+const q = "DELETE FROM map_place";')),
    });
    assert.equal(result.ok, true);
    assert.equal(result.required, false);
  });

  it('ignores +++ and --- header lines', () => {
    const patches = [
      [
        '--- a/src/lib/map/place.ts',
        '+++ b/src/lib/map/place.ts',
        ' context line .query(',
        '+export const n = 1;',
      ].join('\n'),
      ['--- /dev/null', '+++ b/src/lib/map/place.ts', '+export const n = 1;'].join('\n'),
    ];
    for (const patch of patches) {
      const result = evaluate({ body: '', files: files('src/lib/map/place.ts', patch) });
      assert.deepEqual(result.triggers, []);
    }
  });

  it('stays ok with no files when the body is empty or omitted', () => {
    assert.deepEqual(evaluate({ body: '', files: [] }), {
      required: false,
      ok: true,
      triggers: [],
    });
    assert.deepEqual(evaluate({ body: undefined, files: [] }), {
      required: false,
      ok: true,
      triggers: [],
    });
    assert.deepEqual(evaluate({ files: [] }), { required: false, ok: true, triggers: [] });
  });
});

describe('marker visibility', () => {
  const hidden = [
    ['details', `<details>\n${MARKER}\n</details>`],
    [
      'nested details',
      `<details>\n<details open>\n${MARKER}\n</details>\nstill hidden\n</details>`,
    ],
    ['details any case', `<DETAILS>\n${MARKER}\n</DETAILS>`],
    ['backtick fence', `\`\`\`md\n${MARKER}\n\`\`\``],
    ['tilde fence', `~~~\n${MARKER}\n~~~`],
    ['html comment', `<!--\n${MARKER}\n-->`],
  ];

  for (const [name, body] of hidden) {
    it(`rejects a marker that is only inside ${name}`, () => {
      assert.equal(isMarkerVisible(body), false);
      assert.equal(visibleBody(body).includes(PLAIN_MARKER), false);
      const result = evaluate({ body, files: files('docs/schema/map-place.sql', '') });
      assert.equal(result.required, true);
      assert.equal(result.ok, false);
    });
  }

  it('accepts the marker on its own line, including without U+FE0F', () => {
    assert.notEqual(PLAIN_MARKER, MARKER);
    assert.equal(isMarkerVisible(`note\n${MARKER}\n`), true);
    assert.equal(isMarkerVisible(`\n  ${PLAIN_MARKER}  \n`), true);
    const result = evaluate({
      body: PLAIN_MARKER,
      files: files('src/lib/map/store.ts', '+export const n = 1;'),
    });
    assert.equal(result.required, true);
    assert.equal(result.ok, true);
  });

  it('rejects the marker when the same line has other text', () => {
    assert.equal(isMarkerVisible(`see ${MARKER}`), false);
    assert.equal(isMarkerVisible(`${MARKER} now`), false);
    const result = evaluate({
      body: `see ${MARKER}`,
      files: files('integration/job.ts'),
    });
    assert.equal(result.ok, false);
  });

  it('keeps a marker that sits outside a nested details block', () => {
    const body = `<details><details>\nhidden\n</details></details>\n${MARKER}\n`;
    assert.equal(isMarkerVisible(body), true);
    assert.equal(visibleBody(body).includes('hidden'), false);
  });

  it('a ```sql line does not close a fence', () => {
    const body = `\`\`\`md\n\`\`\`sql\n${MARKER}\n\`\`\``;
    assert.equal(isMarkerVisible(body), false);
    assert.equal(evaluate({ body, files: files('docs/schema/map-place.sql', '') }).ok, false);
  });

  it('a marker after a properly closed fence is visible', () => {
    const body = `\`\`\`md\nsample\n\`\`\`\n${MARKER}\n`;
    assert.equal(isMarkerVisible(body), true);
  });

  it('hides a marker inside inline code that spans lines in one paragraph', () => {
    const body = `\`\n${MARKER}\n\``;
    assert.equal(isMarkerVisible(body), false);
    assert.equal(visibleBody(body).includes(PLAIN_MARKER), false);
  });

  it('hides a marker inside a list-item fence', () => {
    const body = `- \`\`\`text\n  ${MARKER}\n  \`\`\``;
    assert.equal(isMarkerVisible(body), false);
  });

  it('hides a marker inside a blockquote fence', () => {
    const body = `> \`\`\`\`\n> ${MARKER}\n> \`\`\`\``;
    assert.equal(isMarkerVisible(body), false);
  });

  it('keeps a marker after a closed list-item fence visible', () => {
    const body = `- \`\`\`text\n  sample\n  \`\`\`\n${MARKER}`;
    assert.equal(isMarkerVisible(body), true);
  });

  it('a four-backtick opener is not closed by a three-backtick line', () => {
    const body = `\`\`\`\`\n\`\`\`\n${MARKER}\n\`\`\`\``;
    assert.equal(isMarkerVisible(body), false);
  });
});

it('a </details> inside inline code does not reveal a hidden marker', () => {
  const body = '<details>\n`</details>`\n\n⚠️ 🗄️ Attention: database change\n\n</details>';
  assert.equal(isMarkerVisible(body), false);
});

it('a </details> inside indented code does not reveal a hidden marker', () => {
  const body = '<details>\n\n    </details>\n\n⚠️ 🗄️ Attention: database change\n\n</details>';
  assert.equal(isMarkerVisible(body), false);
});

it('a visible marker next to inline code stays visible', () => {
  assert.equal(isMarkerVisible('Uses `sql.query`.\n\n⚠️ 🗄️ Attention: database change'), true);
});

describe('hunk anchors', () => {
  it('triggers when the changed line sits in a hunk whose context has an anchor', () => {
    const patch = '@@ -1,3 +1,3 @@\n await db.query(`\n+  WHERE id = $1\n )\n';
    const result = evaluate({ body: '', files: files('src/lib/map/query.ts', patch) });
    assert.deepEqual(result.triggers, ['src/lib/map/query.ts']);
  });

  it('does not trigger when the same added line has no anchor in the hunk', () => {
    const patch = '@@ -1,3 +1,3 @@\n const a = 1;\n+  WHERE id = $1\n const b = 2;\n';
    const result = evaluate({ body: '', files: files('src/lib/map/query.ts', patch) });
    assert.deepEqual(result.triggers, []);
  });

  it('uses OpenCryptoPay schema helpers as anchors', () => {
    for (const anchor of [
      'const store = new SqliteMapPlaceStore(dbPath);',
      'const dbPath = PLACE_DB;',
      'const schema = MAP_PLACE_SCHEMA_SQL;',
      'const columns = "pragma table_info(map_place)";',
    ]) {
      const patch = `@@ -1,2 +1,3 @@\n ${anchor}\n+const changed = true;\n`;
      const result = evaluate({ body: '', files: files('src/index.ts', patch) });
      assert.deepEqual(result.triggers, ['src/index.ts']);
    }
  });

  it('triggers when the anchor and the changed line are in different hunks', () => {
    const patch = [
      '@@ -1,2 +1,2 @@',
      ' await db.query(`',
      ' const keep = 1;',
      '@@ -8,2 +8,3 @@',
      ' const a = 1;',
      '+  WHERE id = $1',
      ' const b = 2;',
    ].join('\n');
    const result = evaluate({ body: '', files: files('src/lib/map/query.ts', patch) });
    assert.deepEqual(result.triggers, ['src/lib/map/query.ts']);
  });

  it('does not trigger when no hunk has an anchor', () => {
    const patch = [
      '@@ -1,2 +1,3 @@',
      ' const a = 1;',
      '+  WHERE id = $1',
      '@@ -8,2 +8,1 @@',
      ' const a = 1;',
      '-const old = 2;',
    ].join('\n');
    const result = evaluate({ body: '', files: files('src/lib/map/query.ts', patch) });
    assert.deepEqual(result.triggers, []);
  });

  it('counts a removed line that starts with --- after the first @@', () => {
    const patch = '@@ -1,3 +1,2 @@\n await db.query(`\n--- SELECT 1 FROM map_place\n )\n';
    const result = evaluate({ body: '', files: files('src/lib/map/query.ts', patch) });
    assert.deepEqual(result.triggers, ['src/lib/map/query.ts']);
  });

  it('counts a removed --- line through the anchor alone', () => {
    const patch = '@@ -1,3 +1,2 @@\n await db.query(`\n--- plain comment\n )\n';
    const result = evaluate({ body: '', files: files('src/lib/map/query.ts', patch) });
    assert.deepEqual(result.triggers, ['src/lib/map/query.ts']);
  });

  it('counts an added +++ line after the first @@', () => {
    const patch = '@@ -1,2 +1,3 @@\n await db.query(`\n+++ plain note\n )\n';
    const result = evaluate({ body: '', files: files('src/lib/map/query.ts', patch) });
    assert.deepEqual(result.triggers, ['src/lib/map/query.ts']);
  });

  it('does not count a --- line after @@ when no anchor exists', () => {
    const patch = '@@ -1,2 +1,1 @@\n const a = 1;\n--- plain comment\n';
    const result = evaluate({ body: '', files: files('src/lib/map/query.ts', patch) });
    assert.deepEqual(result.triggers, []);
  });

  it('triggers on a schema-qualified or quoted UPDATE', () => {
    for (const line of ['+UPDATE main.map_place SET x = 1', '+UPDATE "map_place" SET x = 1']) {
      const result = evaluate({
        body: '',
        files: files('src/lib/map/query.ts', diffWith(line)),
      });
      assert.deepEqual(result.triggers, ['src/lib/map/query.ts']);
    }
  });
});

describe('renames', () => {
  it('triggers when the previous path is a path trigger', () => {
    const result = evaluate({
      files: [
        {
          filename: 'archive/map-place.sql',
          previous_filename: 'docs/schema/map-place.sql',
          status: 'renamed',
          patch: '',
        },
      ],
    });
    assert.equal(result.required, true);
    assert.deepEqual(result.triggers, ['archive/map-place.sql']);
  });

  it('does not trigger a rename between two non-trigger paths', () => {
    const result = evaluate({
      files: [
        {
          filename: 'notes/b.md',
          previous_filename: 'notes/a.md',
          status: 'renamed',
          patch: '',
        },
      ],
    });
    assert.equal(result.required, false);
    assert.deepEqual(result.triggers, []);
  });

  it('scans the patch when the previous path is an inspected source', () => {
    const result = evaluate({
      files: [
        {
          filename: 'docs/x.ts',
          previous_filename: 'src/lib/map/x.ts',
          status: 'renamed',
          patch: '@@ -1 +1 @@\n-const q = "SELECT id FROM map_place";\n+const q = 1;\n',
        },
      ],
    });
    assert.deepEqual(result.triggers, ['docs/x.ts']);
    assert.equal(result.required, true);
  });

  it('fails closed on a rename from an inspected source without a patch', () => {
    const result = evaluate({
      files: [
        {
          filename: 'docs/x.ts',
          previous_filename: 'src/lib/map/x.ts',
          status: 'renamed',
        },
      ],
    });
    assert.deepEqual(result.triggers, ['docs/x.ts']);
  });

  it('does not trigger on a rename from an inspected source when the patch has no database content', () => {
    const result = evaluate({
      files: [
        {
          filename: 'docs/x.ts',
          previous_filename: 'src/lib/map/x.ts',
          status: 'renamed',
          patch: '@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n',
        },
      ],
    });
    assert.deepEqual(result.triggers, []);
  });
});

describe('unclosed hidden regions', () => {
  it('hides a marker after an unclosed details tag', () => {
    assert.equal(isMarkerVisible(`<details>\nsummary\n${MARKER}\n`), false);
    assert.equal(isMarkerVisible(`<DETAILS open>\nsummary\n${MARKER}\n`), false);
  });

  it('hides a marker after an unclosed HTML comment', () => {
    assert.equal(isMarkerVisible(`<!--\n${MARKER}\n`), false);
  });

  it('keeps a marker that sits before an unclosed region', () => {
    assert.equal(isMarkerVisible(`${MARKER}\n<details>\nhidden\n`), true);
    assert.equal(isMarkerVisible(`${MARKER}\n<!--\nhidden\n`), true);
  });

  it('fails evaluate when the marker is only after an unclosed details tag', () => {
    const result = evaluate({
      body: `<details>\nsummary\n${MARKER}\n`,
      files: files('docs/schema/map-place.sql', ''),
    });
    assert.equal(result.required, true);
    assert.equal(result.ok, false);
  });
});

describe('query receivers', () => {
  it('does not trigger on Hono request query parameters', () => {
    const result = evaluate({
      body: '',
      files: files('src/routes/map.ts', diffWith("+  const country = c.req.query('country');")),
    });
    assert.deepEqual(result.triggers, []);
  });

  it('triggers on a generic db.query<Row>( call', () => {
    const result = evaluate({
      body: '',
      files: files(
        'src/lib/map/query.ts',
        diffWith('+  const rows = db.query<PlaceRow>(sql).all();'),
      ),
    });
    assert.deepEqual(result.triggers, ['src/lib/map/query.ts']);
  });
});
