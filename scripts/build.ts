// build/parsed.json と src/ の手書き部分から dist/openapi.yaml を組み立てる
// --todo を付けると、書き直し済みの説明がない原文を build/descriptions-todo.tsv に書き出す
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import YAML from 'yaml';
import type { Parsed, Property } from './parse.ts';

const todoMode = process.argv.includes('--todo');
const parsed: Parsed = JSON.parse(readFileSync('build/parsed.json', 'utf8'));
const base = YAML.parse(readFileSync('src/base.yaml', 'utf8'));
const descriptions: Record<string, string> = existsSync('src/descriptions.yaml')
  ? (YAML.parse(readFileSync('src/descriptions.yaml', 'utf8'), { schema: 'failsafe' }) ?? {})
  : {};

type Override = { nullable?: boolean; required?: boolean; add?: Schema };
const overrides: Record<string, Record<string, Override>> = existsSync('src/overrides.yaml')
  ? (YAML.parse(readFileSync('src/overrides.yaml', 'utf8')) ?? {})
  : {};

// 原文は配布物に含めず、ハッシュをキーにして書き直した説明を引く
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const missing = new Map<string, { contexts: string[]; original: string }>();
function describe(original: string, context: string): string | undefined {
  if (!original) return undefined;
  const key = hash(original);
  if (descriptions[key] !== undefined) return descriptions[key] || undefined;
  const entry = missing.get(key) ?? { contexts: [], original };
  entry.contexts.push(context);
  missing.set(key, entry);
  return undefined;
}

// odpt:stationTimetableObject → StationTimetableObject
const schemaName = (odptName: string) => {
  const local = odptName.replace(/^odpt:/, '');
  return local[0].toUpperCase() + local.slice(1);
};
const ref = (odptName: string) => ({ $ref: `#/components/schemas/${schemaName(odptName)}` });

const TAGS: Record<string, string> = {
  共通クラス: '共通',
  'ODPT Train API': '鉄道',
  'ODPT Bus API': 'バス',
  'ODPT Airplane API': '航空',
};

type Schema = Record<string, unknown>;

// 仕様書の型表記（"string (xsd:dateTime)"、"< odpt:StationOrder > array" など）をJSON Schemaに変換する
function toSchema(notation: string, prop?: Pick<Property, 'name' | 'example' | 'ref'>): Schema {
  const array = notation.match(/^< (.+) > array$/);
  if (array) return { type: 'array', items: prop?.ref ? ref(prop.ref) : toSchema(array[1]) };
  if (prop?.ref) return ref(prop.ref);

  const sameAs = notation.match(/^string \((odpt:\w+) owl:sameAs\)$/);
  if (sameAs) return { type: 'string', 'x-odpt-ref': sameAs[1] };
  const enumeration = notation.match(/^enum \((.+)\)$/);
  if (enumeration && !enumeration[1].endsWith('.yaml')) return { type: 'string', enum: enumeration[1].split(/,\s*/) };

  switch (notation) {
    case 'string':
    case 'string (URL)':
    case 'string (URN)':
    case 'string (xst:string)':
    case 'string (acl:ConsumerKey)':
    case 'enum (Dictionary.yaml)':
      return { type: 'string' };
    case 'string (xsd:dateTime)':
      return { type: 'string', format: 'date-time' };
    case 'string (xsd:date)':
      return { type: 'string', format: 'date' };
    case 'string (odpt:Time)':
      return { $ref: '#/components/schemas/Time' };
    case 'integer':
      return { type: 'integer' };
    case 'number':
      return { type: 'number' };
    case 'number (double)':
      return { type: 'number', format: 'double' };
    case 'boolean':
    case 'boolean (xsd:boolean)':
    case 'boolean (xsd:bool)':
      return { type: 'boolean' };
    case 'object': {
      if (prop?.name === 'ug:region') return { $ref: '#/components/schemas/GeoJSON' };
      const ex = prop?.example ? JSON.parse(prop.example) : undefined;
      if (ex && typeof ex === 'object' && 'ja' in ex) return { $ref: '#/components/schemas/MultilingualText' };
      return { type: 'object' };
    }
  }
  throw new Error(`未対応の型表記: ${notation}`);
}

// "string" や [ "object" ] のような仮置きの例は出力しない
const PLACEHOLDERS = new Set(['string', 'object']);
function example(raw?: string) {
  if (!raw) return undefined;
  const value = JSON.parse(raw);
  if (PLACEHOLDERS.has(value)) return undefined;
  if (Array.isArray(value) && value.every((v) => PLACEHOLDERS.has(v))) return undefined;
  return value;
}

// $ref と兄弟に置けるのは description だけなので、それ以外は allOf で包む
function withMeta(schema: Schema, meta: Schema): Schema {
  const extra = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
  if (!('$ref' in schema)) return { ...schema, ...extra };
  const { description, ...rest } = extra;
  return Object.keys(rest).length ? { allOf: [schema], ...extra } : { ...schema, ...(description ? { description } : {}) };
}

// null を許す。type があれば型の配列に null を足し、$ref などは anyOf で包む
function nullable(schema: Schema): Schema {
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] };
  const { description, example, ...rest } = schema;
  // withMeta が $ref に付けた 1要素の allOf は、anyOf の中では不要なので外す
  const inner = Array.isArray(rest.allOf) && rest.allOf.length === 1 && Object.keys(rest).length === 1 ? rest.allOf[0] : rest;
  return { anyOf: [inner, { type: 'null' }], ...(description ? { description } : {}), ...(example !== undefined ? { example } : {}) };
}

// ---- スキーマ
const schemas: Record<string, Schema> = {};
const topLevel = new Set(parsed.operations.map((o) => o.path.replace(/^\/api\/v4\//, '')));
for (const def of parsed.definitions) {
  const properties: Record<string, Schema> = {};
  const fixes = overrides[schemaName(def.name)] ?? {};
  const required = def.properties.filter((p) => p.required && fixes[p.name]?.required !== false).map((p) => p.name);
  for (const p of def.properties) {
    const schema = toSchema(p.schema, p);
    const meta: Schema = { description: describe(p.description, `${def.name} ${p.name}`), example: example(p.example) };
    if (p.name === '@type' && topLevel.has(def.name)) meta.const = def.name;
    // 実データでは、任意のプロパティに値がないとき null が入ることが多い
    const allowNull = !required.includes(p.name) || fixes[p.name]?.nullable;
    properties[p.name] = allowNull ? nullable(withMeta(schema, meta)) : withMeta(schema, meta);
  }
  for (const [name, fix] of Object.entries(fixes)) {
    if (!fix.add) continue;
    if (properties[name]) throw new Error(`src/overrides.yaml: ${def.name} の ${name} は仕様書にあるので add できない`);
    properties[name] = nullable(fix.add);
  }
  schemas[schemaName(def.name)] = { type: 'object', ...(required.length ? { required } : {}), properties };
}

for (const [cls, props] of Object.entries(overrides))
  for (const name of Object.keys(props))
    if (!(schemas[cls]?.properties as Record<string, unknown> | undefined)?.[name]) throw new Error(`src/overrides.yaml: ${cls}.${name} は存在しない`);

// ---- パス
const errorResponses = (codes: string[]) => {
  const names: Record<string, string> = {
    '400': 'BadRequest',
    '401': 'Unauthorized',
    '403': 'Forbidden',
    '404': 'NotFound',
    '405': 'MethodNotAllowed',
    '500': 'InternalServerError',
    '503': 'ServiceUnavailable',
  };
  return Object.fromEntries(codes.map((c) => [c, { $ref: `#/components/responses/${names[c]}` }]));
};

const paths: Record<string, unknown> = {};
const searchParams = new Map<string, unknown[]>();
for (const op of parsed.operations) {
  if (!op.path.startsWith('/api/v4/')) continue; // File API は手書き
  const cls = op.path.replace(/^\/api\/v4\//, '');
  const parameters = op.parameters
    .filter((p) => p.name !== 'acl:consumerKey')
    .map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required || undefined,
      description: describe(p.description, `${op.path} ?${p.name}`),
      schema: toSchema(p.schema),
    }));
  searchParams.set(cls, parameters);
  const errors = op.responses.map((r) => r.code).filter((c) => c !== '200');
  paths[`/${cls}`] = {
    get: {
      operationId: `search${schemaName(cls)}`,
      tags: [TAGS[op.api]],
      summary: describe(op.description, `${op.path} (operation)`),
      parameters,
      responses: {
        '200': {
          description: '条件に一致したデータの配列。一致するデータがなければ空の配列。',
          // 仕様書のレスポンス例は定義と食い違う箇所（綴りの誤り、必須プロパティの欠落など）が多いので載せない
          content: { 'application/json': { schema: { type: 'array', items: ref(cls) } } },
        },
        ...errorResponses(errors),
      },
    },
  };
}

// データダンプAPI：仕様書1.5節の対応表にあるクラス
const DUMP = [
  'odpt:Calendar', 'odpt:Operator',
  'odpt:Station', 'odpt:StationTimetable', 'odpt:TrainTimetable', 'odpt:TrainType', 'odpt:RailDirection', 'odpt:Railway', 'odpt:RailwayFare', 'odpt:PassengerSurvey',
  'odpt:BusTimetable', 'odpt:BusroutePattern', 'odpt:BusroutePatternFare', 'odpt:BusstopPole', 'odpt:BusstopPoleTimetable',
  'odpt:Airport', 'odpt:AirportTerminal', 'odpt:FlightSchedule', 'odpt:FlightStatus',
];
for (const cls of DUMP) {
  paths[`/${cls}.json`] = {
    get: {
      operationId: `dump${schemaName(cls)}`,
      tags: ['データダンプ'],
      summary: `${cls} の全データを取得`,
      responses: {
        '200': {
          description: 'リダイレクト先から取得した全データ。',
          content: { 'application/json': { schema: { type: 'array', items: ref(cls) } } },
        },
        // 仕様書では301だが、実際のAPIは302を返す（2026年9月29日に確認）
        '302': {
          description: 'ダンプファイルのURLへのリダイレクト。',
          headers: { Location: { description: 'ダンプファイルのURL。', schema: { type: 'string', format: 'uri' } } },
        },
        ...errorResponses(['400', '401', '403', '404', '405', '500', '503']),
      },
    },
  };
}

// 地物情報検索API：仕様書1.7節の対象クラス。通常の検索と同じ絞り込み条件も使える
const PLACES = ['odpt:Station', 'odpt:BusstopPole'];
for (const cls of PLACES) {
  paths[`/places/${cls}`] = {
    get: {
      operationId: `search${schemaName(cls)}ByLocation`,
      tags: ['地物検索'],
      summary: `指定した範囲にある ${cls} を検索`,
      parameters: [
        { name: 'lat', in: 'query', required: true, description: '範囲の中心の緯度（WGS84、10進数）。', schema: { type: 'number' }, example: 35.681265 },
        { name: 'lon', in: 'query', required: true, description: '範囲の中心の経度（WGS84、10進数）。', schema: { type: 'number' }, example: 139.766926 },
        { name: 'radius', in: 'query', required: true, description: '範囲の半径（メートル）。', schema: { type: 'number', minimum: 0, maximum: 4000 }, example: 1000 },
        ...(searchParams.get(cls) ?? []),
      ],
      responses: {
        '200': {
          description: '範囲内で条件に一致したデータの配列。一致するデータがなければ空の配列。',
          content: { 'application/json': { schema: { type: 'array', items: ref(cls) } } },
        },
        ...errorResponses(['400', '401', '403', '404', '405', '500', '503']),
      },
    },
  };
}

if (todoMode) {
  mkdirSync('build', { recursive: true });
  const lines = [...missing].map(([k, v]) => [k, v.contexts.join(', '), v.original.replace(/\n/g, '\\n')].join('\t'));
  writeFileSync('build/descriptions-todo.tsv', lines.join('\n') + '\n');
  console.log(`未作成の説明: ${missing.size} 件 → build/descriptions-todo.tsv`);
  process.exit(0);
}
if (missing.size) {
  console.error(`書き直し済みの説明がない原文が ${missing.size} 件あります。--todo で一覧を出力してください。`);
  process.exit(1);
}

// ID指定の取得（base.yaml に手書き）は、データダンプAPIと同じクラスに対応する。@type の値でどのクラスかがわかる
const datapoints = base.paths['/datapoints/{id}'].get.responses['200'].content['application/json'].schema;
datapoints.items = {
  description: '`@type` の値に対応するクラスのデータ。',
  oneOf: DUMP.map(ref),
  discriminator: { propertyName: '@type', mapping: Object.fromEntries(DUMP.map((cls) => [cls, ref(cls).$ref])) },
};

const doc = {
  ...base,
  paths: { ...paths, ...base.paths },
  components: { ...base.components, schemas: { ...base.components.schemas, ...schemas } },
};
mkdirSync('dist', { recursive: true });
const toYaml = (d: unknown) => YAML.stringify(d, { lineWidth: 0, aliasDuplicateObjects: false });
writeFileSync('dist/openapi.yaml', toYaml(doc));
writeFileSync('dist/openapi.json', JSON.stringify(doc, null, 2) + '\n');
console.log(`dist/openapi.yaml, dist/openapi.json: paths ${Object.keys(doc.paths).length}, schemas ${Object.keys(doc.components.schemas).length}`);

// ---- 分割版：AIなどが必要な分野の定義だけを読めるよう、分野ごとに単独で使える定義を出力する
const SPLITS: Record<string, { tag: string; title: string }> = {
  common: { tag: '共通', title: '共通（曜日・日付区分、事業者）' },
  rail: { tag: '鉄道', title: '鉄道' },
  bus: { tag: 'バス', title: 'バス' },
  air: { tag: '航空', title: '航空' },
  other: { tag: 'その他', title: 'ID指定の取得、ファイル取得' },
};
// 検索APIのタグから、ダンプと地物検索のパスがどの分野かを決める
const classTag = new Map<string, string>();
for (const [path, item] of Object.entries(doc.paths) as [string, any][]) {
  const tag = item.get?.tags?.[0];
  if (tag && Object.values(SPLITS).some((x) => x.tag === tag)) classTag.set(path.replace(/^\//, ''), tag);
}
const splitOf = (path: string, item: any) => {
  const tag = item.get?.tags?.[0];
  if (tag === 'データダンプ') return classTag.get(path.replace(/^\//, '').replace(/\.json$/, ''));
  if (tag === '地物検索') return classTag.get(path.replace(/^\/places\//, ''));
  return tag;
};
// パスから参照されるスキーマを、入れ子の参照もたどって集める
function collectRefs(value: unknown, found: Set<string>) {
  if (Array.isArray(value)) return value.forEach((v) => collectRefs(v, found));
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    const m = k === '$ref' && typeof v === 'string' ? v.match(/^#\/components\/schemas\/(.+)$/) : null;
    if (m && !found.has(m[1])) { found.add(m[1]); collectRefs(doc.components.schemas[m[1]], found); }
    else collectRefs(v, found);
  }
}
mkdirSync('dist/split', { recursive: true });
for (const [name, { tag, title }] of Object.entries(SPLITS)) {
  const paths = Object.fromEntries(Object.entries(doc.paths).filter(([path, item]) => splitOf(path, item) === tag));
  const used = new Set<string>();
  collectRefs(paths, used);
  const usedTags = new Set(Object.values(paths).flatMap((item: any) => item.get?.tags ?? []));
  const part = {
    ...doc,
    info: { ...doc.info, title: `${doc.info.title}：${title}`, description: `${doc.info.description}\n全体の定義は openapi.yaml にあります。` },
    tags: doc.tags.filter((t: any) => usedTags.has(t.name)),
    paths,
    components: { ...doc.components, schemas: Object.fromEntries(Object.entries(doc.components.schemas).filter(([k]) => used.has(k))) },
  };
  writeFileSync(`dist/split/${name}.yaml`, toYaml(part));
  console.log(`dist/split/${name}.yaml: paths ${Object.keys(paths).length}, schemas ${used.size}`);
}

