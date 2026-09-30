// dist/ の定義から openapi-typescript で TypeScript の型を生成する（出力先は build/types/）
// openapi-typescript は TypeScript の JavaScript API を使うが、TypeScript 7 にはこの API がない。
// そこで openapi-typescript からの "typescript" のインポートだけを、併用できる @typescript/typescript6 に振り替える
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';

const root = pathToFileURL(`${process.cwd()}/package.json`).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'typescript' && context.parentURL?.includes('/openapi-typescript/')) {
      return next('@typescript/typescript6', { ...context, parentURL: root });
    }
    return next(specifier, context);
  },
});

const { default: openapiTS, astToString } = await import('openapi-typescript');
const ts = (await import('@typescript/typescript6')).default;

const inputs = ['dist/openapi.yaml', ...readdirSync('dist/split').map((f) => `dist/split/${f}`)];
mkdirSync('build/types', { recursive: true });
for (const input of inputs) {
  const out = `build/types/${input.split('/').pop()!.replace(/\.yaml$/, '')}.d.ts`;
  const ast = await openapiTS(pathToFileURL(input));
  writeFileSync(out, astToString(ast));
  console.log(`${input} → ${out}`);
}
console.log(`openapi-typescript が使った TypeScript: ${ts.version}`);
