// build/samples/（または引数で指定したディレクトリ）の実データを dist/openapi.yaml のスキーマで検証し、エラーを種類ごとに集計する
import { readFileSync, readdirSync } from 'node:fs';
import YAML from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;

const doc = YAML.parse(readFileSync('dist/openapi.yaml', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'openapi', components: doc.components });

// $ref、allOf、anyOf をたどって properties か items を持つスキーマを返す
function resolve(schema: any): any {
  if (!schema) return schema;
  if (schema.$ref) return resolve(doc.components.schemas[schema.$ref.split('/').pop()]);
  if (schema.items) return schema;
  for (const k of ['allOf', 'anyOf']) if (schema[k]) for (const s of schema[k]) { const r = resolve(s); if (r?.properties || r?.items) return r; }
  return schema;
}

const verbose = process.argv.includes('-v');
const dir = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'build/samples';
for (const file of readdirSync(dir).sort()) {
  const { data, status } = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
  if (!Array.isArray(data) || !data.length) { console.log(`${file}: status ${status}, データなし`); continue; }
  const groups = new Map<string, { n: number; sample: string }>();
  for (const item of data) {
    const cls = String(item['@type']).replace(/^odpt:/, '');
    const validate = ajv.getSchema(`openapi#/components/schemas/${cls}`);
    if (!validate) { groups.set(`スキーマなし ${item['@type']}`, { n: 1, sample: '' }); continue; }
    if (validate(item)) continue;
    for (const e of validate.errors ?? []) {
      const where = e.instancePath.replace(/\/\d+/g, '/*');
      const what = e.keyword === 'required' ? `必須の ${e.params.missingProperty} がない`
        : e.keyword === 'enum' ? `enum 外`
        : `${e.keyword} ${e.message}`;
      const key = `${cls} ${where || '/'}: ${what}`;
      const g = groups.get(key) ?? { n: 0, sample: '' };
      g.n++;
      if (!g.sample) {
        const value = e.instancePath.split('/').slice(1).reduce((o: any, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], item);
        g.sample = JSON.stringify(value)?.slice(0, 80) ?? '';
      }
      groups.set(key, g);
    }
  }
  // 定義にないプロパティ（入れ子の型も含む）を数える
  const unknown = new Map<string, number>();
  const walk = (value: any, schema: any, where: string) => {
    if (Array.isArray(value)) { const r = resolve(schema); return value.forEach((v) => walk(v, r?.items ?? r, where)); }
    if (!value || typeof value !== 'object') return;
    schema = resolve(schema);
    if (!schema?.properties) return;
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties[k];
      if (!sub) unknown.set(`${where}.${k}`, (unknown.get(`${where}.${k}`) ?? 0) + 1);
      else walk(v, sub, `${where}.${k}`);
    }
  };
  for (const item of data) walk(item, { $ref: `#/components/schemas/${String(item['@type']).replace(/^odpt:/, '')}` }, String(item['@type']).replace(/^odpt:/, ''));
  for (const [k, n] of unknown) groups.set(`定義にないプロパティ ${k}`, { n, sample: '' });

  console.log(`${file}: ${data.length} 件${groups.size ? '' : ' すべて適合'}`);
  for (const [k, g] of groups) console.log(`  ${g.n}\t${k}${verbose || g.sample.length < 60 ? '\t例: ' + g.sample : ''}`);
}
