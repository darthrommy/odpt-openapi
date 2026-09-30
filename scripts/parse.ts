// ODPT API仕様HTML（Swagger2Markup形式のAsciidoctor出力）を中間JSONに変換する
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [, , input = 'ODPT_4_16.html', output = 'build/parsed.json'] = process.argv;

const $ = cheerio.load(readFileSync(input, 'utf8'));
const text = (e: AnyNode | cheerio.Cheerio<AnyNode>) => $(e).text().replace(/\s+/g, ' ').trim();

export type Param = { in: string; name: string; required: boolean; description: string; schema: string };
export type Response = { code: string; description: string; schema: string; ref?: string };
export type Operation = {
  section: string;
  api: string;
  method: string;
  path: string;
  description: string;
  parameters: Param[];
  responses: Response[];
  exampleRequest?: string;
  exampleResponse?: string;
};
export type Property = {
  name: string;
  required: boolean;
  description: string;
  example?: string;
  schema: string;
  ref?: string;
};
export type Definition = { section: string; api: string; name: string; properties: Property[] };
export type Parsed = { source: string; operations: Operation[]; definitions: Definition[] };

// 「Name / required」セルを名前と必須フラグに分ける
function nameCell(td: cheerio.Cheerio<AnyNode>) {
  const name = text(td.find('strong').first());
  const required = td.find('em').first().text().trim() === 'required';
  return { name, required };
}

// 「説明<br><strong>Example</strong> : <code>...</code>」セルを説明と例に分ける
function descCell(td: cheerio.Cheerio<AnyNode>) {
  const [desc, ex] = (td.html() ?? '').split(/(?:<br>\s*)?<strong>Example<\/strong>\s*:/);
  const description = cheerio.load(desc.replace(/<br>/g, '\n'), null, false).text().split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  if (ex === undefined) return { description };
  return { description, example: cheerio.load(ex, null, false).text().trim() };
}

function schemaCell(td: cheerio.Cheerio<AnyNode>) {
  const link = td.find('a').first();
  return { schema: text(td), ref: link.length ? text(link) : undefined };
}

function rows(table: cheerio.Cheerio<AnyNode>) {
  return table.find('tbody > tr').map((_, r) => [$(r).children('td').toArray().map((c) => $(c))]).get() as cheerio.Cheerio<AnyNode>[][];
}

function headers(table: cheerio.Cheerio<AnyNode>) {
  return table.find('thead th').map((_, th) => text(th)).get().join('|');
}

const operations: Operation[] = [];
const definitions: Definition[] = [];

// h2（章）ごとにAPI名を持つ。2章以降の「パス」「定義」節を対象にする
$('h2').each((_, h2) => {
  const api = text(h2).replace(/^\d+\.\s*/, '');
  const sect1 = $(h2).parent();

  sect1.find('h4').each((_, h4) => {
    const heading = text(h4);
    const m = heading.match(/^(\d+\.\d+\.\d+)\.\s*(.+)$/);
    if (!m) return;
    const [, section, title] = m;
    const sect3 = $(h4).parent();
    const parentTitle = text(sect3.parent().children('h3').first()).replace(/^[\d.]+\s*/, '');

    if (parentTitle === 'パス') {
      const op = title.match(/^(GET|POST|PUT|DELETE)\s+(\S+)$/);
      if (!op) return;
      const sub = (name: string) => sect3.children('.sect4').filter((_, s) => text($(s).children('h5')) === name);
      const operation: Operation = {
        section,
        api,
        method: op[1].toLowerCase(),
        path: op[2],
        description: sub('説明').find('p').map((_, p) => text(p)).get().join('\n'),
        parameters: rows(sub('パラメータ').find('table').first()).map(([type, name, desc, schema]) => ({
          in: text(type).toLowerCase(),
          ...nameCell(name),
          description: descCell(desc).description,
          schema: text(schema),
        })),
        responses: rows(sub('レスポンス').find('table').first()).map(([code, desc, schema]) => ({
          code: text(code),
          description: text(desc),
          ...schemaCell(schema),
        })),
      };
      const req = sub('Example HTTP request').find('pre').first();
      const res = sub('Example HTTP response').find('pre').first();
      if (req.length) operation.exampleRequest = req.text().trim();
      if (res.length) operation.exampleResponse = res.text().trim();
      operations.push(operation);
    } else if (parentTitle === '定義') {
      // 先頭の表がクラス本体、アンカー付きの表は入れ子の型（名前は参照元リンクの文字列）
      let count = 0;
      sect3.find('table').each((_, tbl) => {
        const table = $(tbl);
        if (headers(table) !== 'Name|Description|Schema') return;
        let name = title;
        if (count++ > 0) {
          const anchor = table.attr('id') ?? table.prev('[id]').attr('id') ?? table.parent().attr('id');
          const link = $(`a[href="#${anchor}"]`).first();
          if (!anchor || !link.length) throw new Error(`${section}: 入れ子の表の名前が取れない`);
          name = text(link);
        }
        definitions.push({
          section,
          api,
          name,
          properties: rows(table).map(([nm, desc, schema]) => ({
            ...nameCell(nm),
            ...descCell(desc),
            ...schemaCell(schema),
          })),
        });
      });
    }
  });
});

mkdirSync('build', { recursive: true });
const parsed: Parsed = { source: input, operations, definitions };
writeFileSync(output, JSON.stringify(parsed, null, 2));
console.log(`operations: ${operations.length}, definitions: ${definitions.length}, properties: ${definitions.reduce((n, d) => n + d.properties.length, 0)}`);
