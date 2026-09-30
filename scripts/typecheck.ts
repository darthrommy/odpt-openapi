// 生成したTSの型で、実データと型付きクライアントのコードが型チェックを通るかを確かめる
// 事前に scripts/types.ts で build/types/openapi.d.ts を生成しておく
// --run を付けると、型付きクライアントのコードを実際のAPIに対して実行する（.env の ODPT_CLIENT_KEY を使う）
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const LIMIT = 50;
const OUT = 'build/typecheck';
mkdirSync(OUT, { recursive: true });

// 1. 実データ：クラスごとに型付きの配列リテラルとして書き出す
const lines = ["import type { components } from '../types/openapi.d.ts';", 'type S = components["schemas"];', ''];
let n = 0;
// データ自身の owl:sameAs の末尾をキーにした値はデータ側の誤り（verify.ts が報告する）なので除く
// 例：odpt.StationTimetable:TokyoMetro.Ginza.Ueno.TokyoMetro.Asakusa.Weekday の要素にある "TokyoMetro.Ginza.Ueno.TokyoMetro.Asakusa.Weekday": true
let stripped = 0;
const strip = (value: unknown, sameAs: string): unknown => {
  if (Array.isArray(value)) return value.map((v) => strip(v, sameAs));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !(sameAs.endsWith(`:${k}`) && (stripped++, true)))
      .map(([k, v]) => [k, strip(v, sameAs)]),
  );
};
for (const dir of ['build/samples', 'build/samples-challenge']) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).sort()) {
    const { data } = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
    if (!Array.isArray(data) || !data.length) continue;
    const byType = new Map<string, unknown[]>();
    for (const item of data) {
      const cls = String(item['@type']).replace(/^odpt:/, '');
      const list = byType.get(cls) ?? [];
      if (list.length < LIMIT) list.push(strip(item, String(item['owl:sameAs'] ?? '')));
      byType.set(cls, list);
    }
    for (const [cls, items] of byType) {
      lines.push(`// ${dir}/${file}`);
      lines.push(`export const v${n++}: S[${JSON.stringify(cls)}][] = ${JSON.stringify(items)};`);
    }
  }
}
writeFileSync(`${OUT}/samples.ts`, lines.join('\n') + '\n');

// 2. 型付きクライアント：openapi-fetch で主要なAPIの呼び出しを書く
writeFileSync(`${OUT}/client.ts`, `import createClient from 'openapi-fetch';
import type { paths, components } from '../types/openapi.d.ts';

export function makeClient(key: string, baseUrl = 'https://api.odpt.org/api/v4') {
  const client = createClient<paths>({ baseUrl });
  // acl:consumerKey は securitySchemes なので、パラメータではなくミドルウェアで付ける
  client.use({ onRequest({ request }) { const url = new URL(request.url); url.searchParams.set('acl:consumerKey', key); return new Request(url, request); } });
  return client;
}

export async function examples(client: ReturnType<typeof makeClient>) {
  // 検索：定義にある絞り込み条件は補完が効き、値の型も検査される
  const { data: stations } = await client.GET('/odpt:Station', { params: { query: { 'odpt:operator': 'odpt.Operator:TokyoMetro' } } });
  const title: string | null | undefined = stations?.[0]?.['dc:title'];
  const lat: number | null | undefined = stations?.[0]?.['geo:lat'];

  // 入れ子の型
  const { data: railways } = await client.GET('/odpt:Railway', { params: { query: { 'odpt:operator': 'odpt.Operator:TokyoMetro' } } });
  const order: components['schemas']['StationOrder'][] | undefined = railways?.[0]?.['odpt:stationOrder'];
  const ja: string | undefined = railways?.[0]?.['odpt:railwayTitle']?.ja;

  // null を許すプロパティ
  const { data: trains } = await client.GET('/odpt:Train', { params: { query: { 'odpt:operator': 'odpt.Operator:Toei' } } });
  const to: string | null | undefined = trains?.[0]?.['odpt:toStation'];

  // 地物検索：lat, lon, radius は必須
  const { data: near } = await client.GET('/places/odpt:BusstopPole', { params: { query: { lat: 35.681265, lon: 139.766926, radius: 500 } } });

  // パスパラメータ
  const { data: one } = await client.GET('/datapoints/{id}', { params: { path: { id: 'odpt.Station:TokyoMetro.Ginza.Ueno' } } });
  const file = await client.GET('/files/{path}', { params: { path: { path: 'Toei/data/ToeiBus-GTFS.zip' } }, parseAs: 'blob' });

  // @type は const なので、判別に使える
  const type: 'odpt:Station' | undefined = stations?.[0]?.['@type'];

  return { title, lat, order, ja, to, near, one, file, type };
}

// 型エラーになるべき呼び出し（@ts-expect-error が不要と判定されたら、定義が緩すぎる）
export async function mustFail(client: ReturnType<typeof makeClient>) {
  // @ts-expect-error 地物検索で必須の radius がない
  await client.GET('/places/odpt:Station', { params: { query: { lat: 35.6, lon: 139.7 } } });
  // @ts-expect-error 存在しないパス
  await client.GET('/odpt:Nothing');
  // @ts-expect-error 地物検索の lat は数値
  await client.GET('/places/odpt:Station', { params: { query: { lat: 'x', lon: 139.7, radius: 1 } } });
}
`);

writeFileSync(`${OUT}/tsconfig.json`, JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, allowImportingTsExtensions: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', skipLibCheck: false, types: ['node'] },
  include: ['*.ts', '../types/*.d.ts'],
  // run.ts は Node で直接実行するので、.ts 拡張子付きのインポートを許す
}, null, 2));
// 3. 実行用：client.ts の examples() を実際のAPIに対して呼ぶ
writeFileSync(`${OUT}/run.ts`, `import { readFileSync } from 'node:fs';
import { makeClient, examples } from './client.ts';
const key = readFileSync('.env', 'utf8').match(/^ODPT_CLIENT_KEY=(.*)$/m)![1].trim();
const client = makeClient(key);
client.use({ onResponse({ request, response }) { console.log(response.status, decodeURIComponent(new URL(request.url).pathname)); } });
const r = await examples(client);
console.log({ title: r.title, lat: r.lat, stationOrder: r.order?.length, railwayTitleJa: r.ja, toStation: r.to, nearBusstopPoles: r.near?.length, datapoint: r.one?.[0]?.['@type'], fileStatus: r.file.response.status, fileBytes: r.file.data?.size });
`);

console.log(`${OUT}/samples.ts: ${n} 配列（各最大 ${LIMIT} 件、データ側の誤りのキー ${stripped} 件を除外）、${OUT}/client.ts`);
