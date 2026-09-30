# ODPT API 非公式 OpenAPI 定義

公共交通オープンデータセンター（ODPT）の API について、公開されている API 仕様書（第4.16版）から生成した非公式の OpenAPI 3.1 定義です。

ODPT および公共交通オープンデータ協議会が提供・保証するものではありません。正確な仕様は公式の仕様書で確認してください。

## 定義ファイル

定義は [`dist/openapi.yaml`](dist/openapi.yaml) です。Swagger UI や Redoc での表示、openapi-generator や openapi-typescript でのコード生成に使えます。同じ内容の JSON 版 [`dist/openapi.json`](dist/openapi.json) もあります。

```sh
npx openapi-typescript dist/openapi.yaml -o odpt.d.ts
```

openapi-typescript（7.13.0 で確認）は TypeScript の JavaScript API を使うため、TypeScript 7 しか入っていない環境では `ts.factory` がないというエラーで止まります。TypeScript 7 のプロジェクトでは、併用できる `@typescript/typescript6` を入れ、openapi-typescript からの `typescript` のインポートをそちらに振り替えます。pnpm の overrides は peer dependency には効かないので、[`scripts/types.ts`](scripts/types.ts) では Node の `module.registerHooks` で振り替えています。

[`dist/split/`](dist/split/) には、分野ごとに分けた定義があります。それぞれ単独で使える OpenAPI 定義で、そのパスが参照するスキーマだけを含みます。全体の定義は約190KBあるので、AI に読ませるときは必要な分野のファイルだけを渡すとコンテキストを節約できます。

| ファイル | 内容 |
|---|---|
| `rail.yaml` | 鉄道 |
| `bus.yaml` | バス |
| `air.yaml` | 航空 |
| `common.yaml` | 曜日・日付区分、事業者 |
| `other.yaml` | ID指定の取得、ファイル取得 |

AI 向けの入口として、リポジトリ直下に [`llms.txt`](llms.txt) を置いています。どのファイルを読めばよいかと、公式の仕様書だけでは間違えやすい点をまとめています。

収録している API は次のとおりです。

| 種類 | パス | 件数 |
|---|---|---|
| データ検索 | `/odpt:Station` など | 24 |
| データダンプ | `/odpt:Station.json` など | 19 |
| 地物検索 | `/places/odpt:Station`、`/places/odpt:BusstopPole` | 2 |
| ID指定の取得 | `/datapoints/{id}` | 1 |
| ファイル取得 | `/files/{path}` | 1 |

認証は、クエリパラメータ `acl:consumerKey` に ODPT 開発者サイトで発行されたキーを付けます。定義では `securitySchemes` の `consumerKey` として定義しています。

`servers` には次の2つを載せています。

- `https://api.odpt.org/api/v4`：通常の API
- `https://api-challenge.odpt.org/api/v4`：公共交通オープンデータチャレンジの参加者向け API。参加者に発行されるキーでだけ利用でき、提供されるデータも通常の API と異なります。

## 公式の仕様書との違い

2026年9月29日に両方の API から実データを取得して検証し、仕様書と食い違う点を定義に反映しました。

| 対象 | 仕様書 | 実際の API と、この定義 |
|---|---|---|
| 任意のプロパティ | 値がなければ省略 | `null` が入ることが多いので、任意のプロパティはすべて `null` を許す |
| キーがない・誤っている | 誤っている場合は 401 | どちらも 403 |
| データダンプ API | 301 リダイレクト | 302 リダイレクト |
| ファイル取得 API | `GET /v4/files/?path=…`、キーは任意 | `GET /api/v4/files/{path}`、キーは必須（ないと403） |
| `FlightInformationArrival` / `Departure` | 機材の型式は `odpt:aircraftType` | `odpt:aircratfType`（綴りが異なる）で返ることがあるので両方を定義 |
| `FlightScheduleObject` | `odpt:originTime`、`odpt:destinationTime` は必須 | ないことがあるので任意 |
| `TrainInformation` | `odpt:timeOfOrigin` は必須 | ないことがあるので任意 |
| `Bus` の `@id`、`BusroutePattern` の `dc:title` | 必須 | `null` が入ることがあるので `null` を許す |
| バス系5クラスの `odpt:note`、`Bus` の `odpt:busroute`、`Calendar` と `RailDirection` の `odpt:operator` | 記載なし | 実データにあるので追加 |
| `Time`（時刻） | `HH:MM` | バスの時刻表では `6:56` のように時が1桁のことがあるので、`H:MM` も許す |

補正の内容と、その根拠になった件数は [`src/overrides.yaml`](src/overrides.yaml) にあります。

仕様書に載っているレスポンス例は、定義と食い違う箇所（綴りの誤り、必須プロパティの欠落など）が多いため、この定義には含めていません。プロパティごとの例は含めています。

### 確認できていない点

- `BusroutePattern` の `odpt:openingDoorsToGetOn` / `odpt:openingDoorsToGetOff` の値。仕様書の `odpt:OpeningDoor:FrontSide` などをそのまま `enum` にしていますが、実データ約4,300系統のどこにもこのプロパティがなく、確認できませんでした。
- 実データの検証は、一部の事業者と、1回の取得あたりの上限件数（多くのクラスで1,000件）の範囲で行ったものです。ほかの事業者のデータには、別の食い違いがあるかもしれません。

## 定義の生成

`dist/openapi.yaml` は、仕様書の HTML からスクリプトで生成しています。仕様書の HTML はこのリポジトリに含めていないので、生成し直すには自分で用意する必要があります。

必要なもの：Node.js 24 以上、pnpm

1. ODPT 開発者サイトの API 仕様書のページを HTML として保存し、リポジトリの直下に `ODPT_4_16.html` の名前で置きます。
2. 依存パッケージを入れて、生成と検査を実行します。

   ```sh
   pnpm install
   pnpm all
   ```

`pnpm all` は次の3つを順に実行します。型の生成と検査は `pnpm types` と `pnpm typecheck` で別に実行します。

| コマンド | 内容 |
|---|---|
| `pnpm parse` | 仕様書の HTML を `build/parsed.json` に変換する |
| `pnpm build` | `build/parsed.json` と `src/` の手書き部分から `dist/` の定義（全体の YAML と JSON、分野ごとの分割版）を作る |
| `pnpm lint` | Redocly CLI で `dist/` の定義を検査する |
| `pnpm types` | openapi-typescript で `dist/` の定義から `build/types/` に型を生成する |
| `pnpm typecheck` | 生成した型で、実データ（クラスごとに最大50件）と、openapi-fetch を使ったクライアントのコードを、TypeScript 7 と 6 で型チェックする |

### ファイル構成

| パス | 内容 |
|---|---|
| `scripts/parse.ts` | 仕様書の HTML（Swagger2Markup 形式の表）を中間 JSON に変換する |
| `scripts/build.ts` | 中間 JSON から OpenAPI 定義を組み立てる |
| `scripts/fetch.ts` | 実データを取得する |
| `scripts/verify.ts` | 実データを定義で検証し、食い違いを集計する |
| `scripts/types.ts` | TypeScript の型を生成する |
| `scripts/typecheck.ts` | 型チェック用のコードを `build/typecheck/` に書き出す |
| `scripts/extract-text.ts` | 仕様書の指定した節を本文テキストで出力する |
| `src/base.yaml` | 手書き部分（全体の説明、認証、`datapoints` とファイル取得の API、共通スキーマ） |
| `src/descriptions.yaml` | 各項目の説明文 |
| `src/overrides.yaml` | 実データに合わせた補正 |

説明文は仕様書の文章を使わず、書き直したものを `src/descriptions.yaml` に置いています。キーは原文の SHA-256 の先頭10文字で、原文そのものはリポジトリに含まれません。

### 仕様書の版が上がったとき

1. 新しい HTML を置き、`node scripts/parse.ts <ファイル名>` で変換します。
2. `pnpm todo` を実行すると、原文が変わったか新しく増えた説明文が `build/descriptions-todo.tsv` に出力されます。書き直して `src/descriptions.yaml` に追加します。
3. 仕様書の1章（検索の仕組みや汎用 API）は `src/base.yaml` に手で書いています。`node scripts/extract-text.ts "1.3." "2. "` で新旧の本文を出力し、差分を確認して反映します。
4. `pnpm build && pnpm lint` で生成と検査をします。
5. 下の手順で実データと照らし合わせます。

### 実データでの検証

`.env` に API キーを置きます。このファイルは `.gitignore` の対象です。

```sh
ODPT_CLIENT_KEY=通常のAPIのキー
ODPT_EXCLUSIVE_KEY=チャレンジ参加者向けAPIのキー
```

```sh
pnpm fetch                                        # 通常の API → build/samples/
node scripts/fetch.ts --challenge --wide          # チャレンジ参加者向け API → build/samples-challenge/
pnpm verify                                       # build/samples/ を検証
node scripts/verify.ts build/samples-challenge    # build/samples-challenge/ を検証
```

型付きクライアントのコードを実際の API に対して実行するには、`pnpm typecheck` のあとに `node build/typecheck/run.ts` を実行します。

`--wide` を付けると、全クラスを条件なしでも取得します。上限件数まで複数の事業者のデータが混ざるので、検証できる範囲が広がります。

`verify` は、定義に合わないデータと、定義にないプロパティを種類ごとに件数で出力します。2026年9月29日時点では、東京メトロ銀座線上野駅の駅時刻表に含まれる余計なキー（`"TokyoMetro.Ginza.Ueno.TokyoMetro.Asakusa.Weekday": true` など、データ自身の ID の一部をキーにしたもの）だけが出ます。これはデータ側の誤りと判断し、定義には入れていません。

## ライセンス

[CC0 1.0](LICENSE) です。定義もスクリプトも、条件なしで利用できます。

API から取得するデータのライセンスは、この定義とは別で、事業者ごとに異なります。ODPT 開発者サイトで確認してください。
