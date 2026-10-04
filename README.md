# pi-plan

Claude Code の plan mode を Pi の拡張として再現します。plan mode は、実装前に調査し、プランをファイルに書き、ユーザーの承認を得るまでモデルに書き込みを控えさせるモードです。

```
ユーザー: 認証方式を OAuth に変えて
  assistant: (read / grep で調査) → プランファイルに実装プランを書く
  assistant: exit_plan_mode を呼ぶ
  ★ 承認ダイアログ: 実行 / 編集して実行 / 継続
  assistant: 承認されたプランに沿って実装する
```

## インストール

```bash
pi install git:github.com/kurowashi/pi-plan
```

ref を固定する場合は `pi install git:github.com/kurowashi/pi-plan@<tag|commit>`。

ローカルの作業コピーを使う場合:

```bash
pi install /path/to/pi-plan
```

または直接読み込み:

```bash
pi --extension /path/to/pi-plan/src/index.ts
```

## 使い方

### plan mode に入る

| 経路 | 操作 |
|---|---|
| コマンド | `/plan` または `/plan <タスク>`(タスクは開始と同時に送られます) |
| ショートカット | Ctrl+Alt+P(トグル) |
| 起動フラグ | `pi --plan` |
| モデルの提案 | `enter_plan_mode` が同意を求めます。同意すると plan mode に入ります |

plan mode 中はステータス行に `⏸ plan mode on` が表示されます。plan mode 中に `/plan` を実行すると、現在のプラン本文と保存先を通知表示します。

### plan mode でモデルがすること

- 読み取り専用のツールで調査する。
- 実装プランをプランファイルに書く。書き込みが許されるのはプランファイルだけです。
- `exit_plan_mode` を呼び、承認を求める。ターンは質問か `exit_plan_mode` のどちらかで終わります。

### plan mode を出る

| 経路 | 承認 | 動作 |
|---|---|---|
| `exit_plan_mode` の承認 | 必要 | 選んだ内容をモデルへ返し、実装を許可する |
| Ctrl+Alt+P | 不要 | plan mode を終了する(Claude Code の Shift+Tab に対応) |

承認ダイアログの選択肢は次の 3 つです。

| 選択肢 | 動作 | モデルへの返却 |
|---|---|---|
| `Yes, execute the plan` | plan mode を終了する | 承認済みプラン全文 |
| `Edit the plan, then execute` | plan mode を終了する | 編集後のプラン全文(`edited by user` を明示) |
| `No, keep planning` | plan mode のまま | 拒否の事実と入力したフィードバック |

モデルは `exit_plan_mode` 以外で plan mode を終了できません。プラン承認をテキストや質問で求めることは禁止しています。`enter_plan_mode` の同意で拒否した場合も、モードは変わりません。

## プランファイル

プラン本文の正は `~/.pi/agent/plans/<slug>.md` です(`PI_CODING_AGENT_DIR` を設定している場合はその下)。プラン本文はモデルが書き、ユーザーは承認前に編集できます。

- `exit_plan_mode` は本文を引数で受け取らず、ファイルから読みます。
- 承認前に編集された場合、編集後の内容がモデルへ返り、`edited by user` と明示されます。
- ファイルが欠落していても承認でき、空のプランとして扱います。
- セッション再開では同じファイルを再利用し、fork では新しい slug を生成します。
- プラン本文はセッションには保存しません。

## Claude Code との差

主な差は次のとおりです。全量は [DESIGN.md](DESIGN.md) の互換性マトリクスにあります。

| 差 | pi-plan |
|---|---|
| 書き込みの強制 | ありません。書き込まないようプロンプトで指示するだけで、違反を止める仕組みはありません |
| 開始のショートカット | Ctrl+Alt+P です(pi では Shift+Tab を使えないため) |
| コンテキストクリア承認 | ありません。承認後も現在のコンテキストで実装します |
| 権限モードの退避・復元 | ありません。承認後は pi の通常動作に戻ります |
| 質問ツール | 特定のツール名に依存しません(pi に標準の質問ツールがないため) |
| 探索/計画サブエージェント | 使用を推奨するだけです。無ければモデルが直接探索します |

## データと副作用

| 対象 | 内容 |
|---|---|
| プランファイル | `~/.pi/agent/plans/` に作成する |
| セッション | モードと slug を `plan-mode` entry に保存する |
| プロンプト | plan mode 中はユーザーターン 5 回ごとに指示を再注入する(画面には表示されない) |
| ネットワーク | 外部へ送信しない |

非対話モード(print / JSON)では承認ダイアログを出せないため、`exit_plan_mode` は承認されず、理由をモデルへ返します。

## 開発

```bash
npm install          # 依存(すべて devDependency。実行時依存はゼロ)
npm run verify       # 完了条件: biome + tsc + 全テスト + カバレッジ閾値
npm test             # 全テスト
```

`npm run verify` の内訳は `package.json` にあります。契約テストは `test/contract/`(ツール・コマンド・イベントの面、依存 allowlist、import 境界)と `test/ci/`(npm pack の内容)にあり、`src` を Pi のローダー経由で読み込んで検証します。カバレッジ閾値は `test/unit/` と `test/integration/` の実行で計測します。

ローカルの git フックは [lefthook](lefthook.yml) が管理します。フックは利便性のためのもので、完了条件は常に `npm run verify` が通ることです(CI も同じコマンドを Node 22.19 / 24 で実行します)。フックの有効化は `npx lefthook install` を手動で実行します(`package.json` の lifecycle script には置きません: `pi install git:...` は `npm install --omit=dev` を実行するため、devDependency の lefthook が無い状態で script が走るとインストールごと失敗します)。
