// 実データを取得して build/samples/ に保存する。APIキーは .env に置く
//   node scripts/fetch.ts               通常のAPI（ODPT_CLIENT_KEY）
//   node scripts/fetch.ts --challenge   ハッカソン用のAPI（ODPT_EXCLUSIVE_KEY）→ build/samples-challenge/
//   --wide を付けると、全クラスを条件なしでも取得する（上限件数まで複数事業者のデータが混ざる）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const challenge = process.argv.includes('--challenge');
const wide = process.argv.includes('--wide');
const keyName = challenge ? 'ODPT_EXCLUSIVE_KEY' : 'ODPT_CLIENT_KEY';
const key = readFileSync('.env', 'utf8').match(new RegExp(`^${keyName}=(.*)$`, 'm'))?.[1].trim();
if (!key) throw new Error(`.env に ${keyName} がない`);
const BASE = challenge ? 'https://api-challenge.odpt.org/api/v4' : 'https://api.odpt.org/api/v4';
const OUT = challenge ? 'build/samples-challenge' : 'build/samples';
mkdirSync(OUT, { recursive: true });

async function get(path: string, params: Record<string, string> = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries({ ...params, 'acl:consumerKey': key! })) url.searchParams.set(k, v);
  return fetch(url);
}

async function save(name: string, path: string, params: Record<string, string> = {}) {
  const res = await get(path, params);
  const body = await res.text();
  let data: unknown;
  try { data = JSON.parse(body); } catch { data = undefined; }
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ path, params, status: res.status, data: data ?? body.slice(0, 500) }, null, 1));
  console.log(`${name}\t${res.status}\t${Array.isArray(data) ? data.length + ' 件' : typeof data}`);
  return Array.isArray(data) ? (data as Record<string, any>[]) : [];
}

const METRO = 'odpt.Operator:TokyoMetro';
const first = <T>(xs: T[] | T | undefined) => (Array.isArray(xs) ? xs[0] : xs);

await save('Calendar', '/odpt:Calendar');
await save('Operator', '/odpt:Operator');
await save('PassengerSurvey', '/odpt:PassengerSurvey', { 'odpt:operator': METRO });
await save('RailDirection', '/odpt:RailDirection');
await save('Railway', '/odpt:Railway', { 'odpt:operator': METRO });
await save('RailwayFare', '/odpt:RailwayFare', { 'odpt:fromStation': 'odpt.Station:TokyoMetro.Ginza.Ueno' });
await save('Station', '/odpt:Station', { 'odpt:operator': METRO });
await save('StationTimetable', '/odpt:StationTimetable', { 'odpt:station': 'odpt.Station:TokyoMetro.Ginza.Ueno' });
await save('Train', '/odpt:Train', { 'odpt:operator': 'odpt.Operator:Toei' });
await save('TrainInformation', '/odpt:TrainInformation', { 'odpt:operator': METRO });
await save('TrainTimetable', '/odpt:TrainTimetable', { 'odpt:railway': 'odpt.Railway:TokyoMetro.Ginza', 'odpt:calendar': 'odpt.Calendar:Weekday' });
await save('TrainType', '/odpt:TrainType', { 'odpt:operator': METRO });

// バスは東京駅周辺のバス停から芋づる式にたどる（地物検索APIの確認も兼ねる）
const poles = await save('places-BusstopPole', '/places/odpt:BusstopPole', { lat: '35.681265', lon: '139.766926', radius: '500' });
await save('places-Station', '/places/odpt:Station', { lat: '35.681265', lon: '139.766926', radius: '500' });
const pole = poles.find((p) => p['odpt:operator']?.includes('odpt.Operator:Toei') && p['odpt:busroutePattern']?.length) ?? poles[0];
const pattern = first(pole?.['odpt:busroutePattern']) as string | undefined;
const busOperator = first(pole?.['odpt:operator']) as string | undefined;
if (pole) await save('BusstopPole', '/odpt:BusstopPole', { 'owl:sameAs': pole['owl:sameAs'] });
if (pattern) {
  await save('BusroutePattern', '/odpt:BusroutePattern', { 'owl:sameAs': pattern });
  await save('BusTimetable', '/odpt:BusTimetable', { 'odpt:busroutePattern': pattern });
}
if (pole) {
  await save('BusstopPoleTimetable', '/odpt:BusstopPoleTimetable', { 'odpt:busstopPole': pole['owl:sameAs'] });
  await save('BusroutePatternFare', '/odpt:BusroutePatternFare', { 'odpt:fromBusstopPole': pole['owl:sameAs'] });
}
if (busOperator) await save('Bus', '/odpt:Bus', { 'odpt:operator': busOperator });

await save('Airport', '/odpt:Airport');
await save('AirportTerminal', '/odpt:AirportTerminal');
await save('FlightStatus', '/odpt:FlightStatus');
await save('FlightInformationArrival', '/odpt:FlightInformationArrival', { 'odpt:operator': 'odpt.Operator:JAL', 'odpt:airline': 'odpt.Operator:JAL' });
await save('FlightInformationDeparture', '/odpt:FlightInformationDeparture', { 'odpt:operator': 'odpt.Operator:JAL', 'odpt:airline': 'odpt.Operator:JAL' });
await save('FlightSchedule', '/odpt:FlightSchedule', { 'odpt:originAirport': 'odpt.Airport:HND', 'odpt:destinationAirport': 'odpt.Airport:ITM' });

await save('datapoints', '/datapoints/odpt.Station:TokyoMetro.Ginza.Ueno');

if (wide) {
  const CLASSES = ['Calendar', 'Operator', 'PassengerSurvey', 'RailDirection', 'Railway', 'RailwayFare', 'Station', 'StationTimetable', 'Train', 'TrainInformation', 'TrainTimetable', 'TrainType',
    'Bus', 'BusTimetable', 'BusroutePattern', 'BusroutePatternFare', 'BusstopPole', 'BusstopPoleTimetable',
    'Airport', 'AirportTerminal', 'FlightInformationArrival', 'FlightInformationDeparture', 'FlightSchedule', 'FlightStatus'];
  for (const cls of CLASSES) await save(`wide-${cls}`, `/odpt:${cls}`);
}
