// 仕様書HTMLの見出し from から to の直前までを本文テキストで出力する。版が上がったときに1章などの差分を取るのに使う
// 例: node scripts/extract-text.ts "1.3." "2. "
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
const $ = cheerio.load(readFileSync('ODPT_4_16.html','utf8'));
const [, , from, to] = process.argv;
// 見出し from から to の直前までを本文テキストで出す（表はタブ区切り）
const out: string[] = []; let on = false;
$('h2,h3,h4,h5,p,pre,tr,li').each((_, e) => {
  const tag = e.tagName; const t = $(e).text().replace(/\s+/g, ' ').trim();
  if (/^h[2-5]$/.test(tag)) { if (t.startsWith(from)) on = true; else if (to && t.startsWith(to)) on = false; }
  if (!on) return;
  if ($(e).parents('td,li').length && tag === 'p') return;
  if (tag === 'tr') out.push($(e).children().map((_, c) => $(c).text().replace(/\s+/g, ' ').trim()).get().join('\t'));
  else if (tag === 'pre') out.push('```\n' + $(e).text().trim() + '\n```');
  else out.push(/^h/.test(tag) ? `\n## ${t}` : t);
});
console.log(out.join('\n'));
