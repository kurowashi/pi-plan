# pi-plan

Claude Code の plan mode を Pi の拡張として再現します。plan mode は、実装前に調査してプランをファイルに書き、ユーザーの承認を得てから実装に進むモードです。

読み取り専用で動作するようプロンプトで指示しますが、書き込みを技術的に止める仕組みはありません([Claude Code との差](#claude-code-との差)を参照)。

```
ユーザー: 認証方式を OAuth に変えて
  assistant: enter_plan_mode を呼ぶ
  ★ 同意ダイアログ: Yes, enter plan mode / No, start implementing now
  assistant: (read / grep で調査) → プランファイルに実装プランを書く
  assistant: exit_plan_mode を呼ぶ
  ★ 承認ダイアログ: Yes, execute the plan / Edit the plan, then execute / No, keep planning
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
| モデルの提案 | `enter_plan_mode` が同意を求め、`Yes, enter plan mode` で入ります(`No, start implementing now` で拒否) |

plan mode 中はステータス行に `⏸ plan mode on` が表示されます。plan mode 中に引数なしの `/plan` を実行すると、現在のプラン本文と保存先を通知表示します(プランファイルがない場合はその旨を表示します)。

### plan mode でモデルがすること

- 読み取り専用のツールで調査する。
- 実装プランをプランファイルに書く。プランファイル以外へ書き込まないことはプロンプトで指示しますが、技術的な強制はありません。
- `exit_plan_mode` を呼び、承認を求める。ターンは質問か `exit_plan_mode` のどちらかで終わります。

### plan mode を出る

| 経路 | 承認 | 動作 |
|---|---|---|
| `exit_plan_mode` で実行を選ぶ | 必要 | plan mode を終了し、承認済みプラン全文をモデルへ返す |
| `exit_plan_mode` で編集して実行を選ぶ | 必要 | plan mode を終了し、編集後のプラン全文を返す |
| `exit_plan_mode` で継続を選ぶ | 選択 | plan mode のまま、フィードバックを返す |
| Ctrl+Alt+P | 不要 | plan mode を終了する(Claude Code の Shift+Tab に対応) |

承認ダイアログの選択肢は次の 3 つです。

| 選択肢 | 動作 | モデルへの返却 |
|---|---|---|
| `Yes, execute the plan` | plan mode を終了する | 承認済みプラン全文(空のときは短い承認文) |
| `Edit the plan, then execute` | plan mode を終了する | 編集後のプラン全文(`edited by user` を明示) |
| `No, keep planning` | plan mode のまま | 拒否の事実と入力したフィードバック |

モデルは `exit_plan_mode` 以外で plan mode を終了できません。プラン承認をテキストや質問で求めることは禁止しています。

## プランファイル

プラン本文の正は `$PI_CODING_AGENT_DIR/plans/<slug>.md` です(`PI_CODING_AGENT_DIR` が未設定の場合は `~/.pi/agent/plans/<slug>.md`)。プラン本文はモデルが書き、ユーザーは承認前に編集できます。

- `exit_plan_mode` は本文を引数で受け取らず、ファイルから読みます。
- 承認前に編集された場合、編集後の内容がモデルへ返り、`edited by user` と明示されます。
- ファイルが欠落または空でも承認でき、その場合はプラン全文を返さず短い承認文だけを返します。
- セッション再開では同じファイルを再利用し、plan mode 中の fork では新しい slug を生成します。
- プラン本文はセッションには保存しません。

## Claude Code との差

主な差は次のとおりです。全量は [DESIGN.md](DESIGN.md) の互換性マトリクスにあります。

| 差 | pi-plan | 利用者への影響 |
|---|---|---|
| 書き込みの強制 | プロンプト指示のみ | モデルが指示に反して書き込む可能性があります |
| 開始のショートカット | Ctrl+Alt+P | pi では Shift+Tab を使えないためです |
| コンテキストクリア承認 | 非対応 | 承認後も同じコンテキストで実装するため、トークン消費が増えます |
| 権限モード | なし | 承認後は pi の通常動作に戻ります |
| 質問ツール | 特定の名前を使わない | pi に標準の質問ツールがないためです |
| 探索/計画サブエージェント | 推奨のみ | 無ければモデルが直接探索します |

## データと副作用

| 対象 | 内容 |
|---|---|
| プランファイル | `$PI_CODING_AGENT_DIR/plans/` に作成する(未設定時は `~/.pi/agent/plans/`) |
| セッション | plan mode の状態とプランファイル名を保存する |
| プロンプト | plan mode 中は初回と、以降 5 ユーザーターンごとに指示を再注入する(注入 5 回に 1 回は全文、それ以外は要約。compaction の直後は full からやり直す。画面には表示されない) |
| ネットワーク | pi-plan 自身は通信しない(Pi 本体とモデルの通信は対象外) |

非対話モード(`pi --print` / `pi --mode json`)では承認ダイアログを出せません。`enter_plan_mode` と `exit_plan_mode` はどちらも承認されず、理由をモデルへ返します。

## 開発

```bash
npm install          # 依存(すべて devDependency。実行時依存はゼロ)
npm run verify       # 完了条件: biome + tsc + 全テスト + カバレッジ閾値
npm test             # 全テスト
```

`npm run verify` の内訳は `package.json` にあります。契約テストは `test/contract/`(ツール・コマンド・イベントの面、依存 allowlist、import 境界)と `test/ci/`(npm pack の内容)にあり、`src` を Pi のローダー経由で読み込んで検証します。カバレッジ閾値は `test/unit/` と `test/integration/` の実行で計測します。

ローカルの git フックは [lefthook](lefthook.yml) が管理します。フックは利便性のためのもので、完了条件は常に `npm run verify` が通ることです(CI も同じコマンドを Node 22.19 / 24 で実行します)。フックの有効化は `npx lefthook install` を手動で実行します(`package.json` の lifecycle script には置きません: `pi install git:...` は `npm install --omit=dev` を実行するため、devDependency の lefthook が無い状態で script が走るとインストールごと失敗します)。
