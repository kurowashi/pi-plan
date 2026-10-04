# AGENTS.md — pi-plan で作業するエージェント向けの指示

読者は pi-plan を変更する AI エージェントと開発者です。利用者向けの仕様は README に、
設計の判断基準は DESIGN.md と PHILOSOPHY.md(このプラグイン群共通)に書きます。

ここには、壊してはいけない制約と、制約に触れる変更の手順だけを書きます。制約の正はテストで、
下の表はその索引です。実装と表が食い違った場合はテストが正です。検証手段を併記できないものは制約として書かず、
自動テストできない範囲は末尾に分けます。

## 完了条件

`npm run verify`(= `npm run check` + `npm test` + `npm run test:coverage`)が通ること。
フックが通っても CI が通らなければ未完了。CI は同じ `verify` を Node 22.19 / 24 で実行します。
カバレッジは `test/unit` と `test/integration` で計測します。下の表の「検証」列は個別の検証箇所であり、
自動検証はすべて `verify` に含まれます。

## 制約

### フック面

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| モデル向けツールは `enter_plan_mode` と `exit_plan_mode` の2つだけ | `test/contract/surface.test.ts` | `src/index.ts` |
| コマンドは `/plan` の1つだけ | `test/contract/surface.test.ts` | `test/contract/surface.test.ts` の期待値 |
| ショートカットは `ctrl+alt+p` の1つだけ(plan mode のトグル) | `test/contract/surface.test.ts` | `test/contract/surface.test.ts` の期待値 |
| フラグは `plan` の1つだけ | `test/contract/surface.test.ts` | `test/contract/surface.test.ts` の期待値 |
| イベントは `session_start` と `before_agent_start` の2種で、各1ハンドラ | `test/contract/surface.test.ts` | `test/contract/surface.test.ts` の `EXPECTED_EVENTS`、`src/index.ts` |
| `tool_call` ハンドラを登録しない(読み取り専用はプロンプトで指示する) | `test/contract/surface.test.ts` | `test/contract/surface.test.ts` の `EXPECTED_EVENTS` |

### プランファイル

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| 保存先は `$PI_CODING_AGENT_DIR/plans`、未設定時は `~/.pi/agent/plans` | `test/unit/plans.test.ts` | `src/plans.ts` の `getPlansDirectory` |
| ファイル名は `<slug>.md` で、slug は形容詞・動詞・名詞のリストから各1語を選んだ3語 | `test/unit/plans.test.ts` | `src/plans.ts` の `generateSlug` |
| 形容詞・動詞・名詞のリストは空でなく、重複した語を含まない | `test/unit/plans.test.ts` | `src/words.ts` の `ADJECTIVES` / `VERBS` / `NOUNS` |
| slug は初回を含めて最大10回試行し、すべて衝突した場合は最後の slug を使う | `test/unit/plans.test.ts` | `src/plans.ts` の `generateSlug` |
| slug はセッション単位でキャッシュし、再開では再利用、fork では新規生成する | `test/integration/extension.test.ts` | `src/plans.ts` |
| プラン本文はファイルだけに保存し、entry には保存しない | `test/integration/extension.test.ts` | `src/plans.ts` |
| `exit_plan_mode` は本文を引数で受け取らず、プランファイルから読む | `test/integration/extension.test.ts` | `src/tools.ts` |
| プランファイルが欠落していても exit でき、空プランとして扱う | `test/integration/extension.test.ts` | `src/tools.ts` |
| 承認前に編集された場合はファイルへ書き戻し、`edited by user` を tool_result に付ける | `test/integration/extension.test.ts` | `src/tools.ts` |

### モードと永続化

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| 開始経路は `/plan`、Ctrl+Alt+P、`enter_plan_mode` の承認の3つ | `test/integration/extension.test.ts` | `src/index.ts` |
| 終了経路は `exit_plan_mode` の承認と Ctrl+Alt+P の2つだけ | `test/integration/extension.test.ts` | `src/index.ts` |
| `/plan <タスク>` は開始と同時にタスクを送る | `test/integration/extension.test.ts` | `src/index.ts` |
| plan mode 中の `/plan` はプラン本文と保存先を通知表示し、モードを変えない | `test/integration/extension.test.ts` | `src/index.ts` |
| `--plan` で起動したセッションは開始時に plan mode になる | `test/integration/extension.test.ts` | `src/index.ts` |
| モード状態・終了通知の送信待ち・再突入の送信待ちは `customType: "plan-mode"` の entry に保存し、`session_start` で分岐から復元する | `test/unit/state.test.ts` + `test/integration/extension.test.ts` | `src/state.ts` |
| 復元できない entry・未知の値は plan mode 外として扱い、セッションを止めない | `test/unit/state.test.ts` | `src/state.ts` |
| plan mode 外で `exit_plan_mode` を呼んでもモードを変えず、エラーを返す | `test/integration/extension.test.ts` | `src/tools.ts` |
| plan mode 中に `enter_plan_mode` を呼んでもモードを変えず、その旨を返す | `test/integration/extension.test.ts` | `src/tools.ts` |
| Ctrl+Alt+P の終了でも終了通知を1回注入する | `test/integration/extension.test.ts` | `src/index.ts` |

### プロンプト

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| full は5フェーズ全文、sparse は1段落の要約 | `test/unit/prompts.test.ts` | `src/prompts.ts` |
| カウンタは人間のユーザーメッセージだけで進み、meta と tool result では進まない | `test/unit/state.test.ts` | `src/state.ts` |
| 再突入メッセージは「終了済み」かつ「プランファイルあり」のときだけ1回 | `test/integration/extension.test.ts` | `src/index.ts` |
| 終了通知は plan mode 終了直後の1回だけ | `test/integration/extension.test.ts` | `src/index.ts` |
| compaction より前の注入を数えず、compaction 後の次リクエストで full を再注入する | `test/unit/state.test.ts` | `src/state.ts` |
| 文面に `EnterPlanMode` / `ExitPlanMode` / `AskUserQuestion` を残さず、`enter_plan_mode` / `exit_plan_mode` と一般的な質問表現にする | `test/unit/prompts.test.ts` | `src/prompts.ts` |
| プラン承認をテキストや質問ツールで尋ねない指示を含む | `test/unit/prompts.test.ts` | `src/prompts.ts` |
| 注入メッセージは `display: false` で、`customType` は `plan-mode-context` と `plan-mode-exit` | `test/integration/extension.test.ts` | `src/index.ts` |

### 承認UI

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| `enter_plan_mode` は同意を求め、拒否ならモードを変えない | `test/integration/extension.test.ts` | `src/tools.ts` |
| 同意の選択肢は `Yes, enter plan mode` と `No, start implementing now` の2つ | `test/integration/extension.test.ts` | `src/tools.ts` |
| 承認の選択肢は `Yes, execute the plan` / `Edit the plan, then execute` / `No, keep planning` の3つだけ | `test/integration/extension.test.ts` | `src/tools.ts` |
| `ctx.hasUI` が false のモード(print / JSON)では承認せず、理由を tool_result で返す | `test/integration/extension.test.ts` | `src/tools.ts` |
| `exit_plan_mode` の承認時、tool_result にプラン全文と保存先をエコーする | `test/integration/extension.test.ts` | `src/tools.ts` |
| 継続時は入力されたフィードバックを tool_result に含める | `test/integration/extension.test.ts` | `src/tools.ts` |
| ステータスは plan mode 中 `⏸ plan mode on`、それ以外は消す | `test/integration/extension.test.ts` | `src/index.ts` |

### 依存関係・import

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| 実行時依存を持たない(`dependencies` は空) | `test/contract/dependencies.test.ts` | `package.json` |
| `src` の import は node builtin・相対 `.ts`・Pi 提供パッケージのみ | `test/contract/dependencies.test.ts` | `test/contract/dependencies.test.ts` の `ALLOWED_PEER_DEPENDENCIES` |
| devDependency は allowlist 内のみ | `test/contract/dependencies.test.ts` | `test/contract/dependencies.test.ts` の `ALLOWED_DEV_DEPENDENCIES` |

### 配布・ビルド

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| 配布物は `files` の whitelist 内のみ | `test/ci/package-contents.test.ts` | `package.json` の `files` |
| `pi.extensions` のエントリが配布物に含まれる | `test/ci/package-contents.test.ts` | `package.json` の `pi.extensions` |
| ビルド工程を持たない(TS を直接配布) | `test/ci/package-contents.test.ts` | `package.json`(`build` script なし、`pi.extensions` が `./src/index.ts`) |

### コード品質

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| `enum` / `namespace` / parameter properties を使わない | `npx tsc --noEmit` | `tsconfig.json` の `erasableSyntaxOnly` |
| 型は `any` なし、非null断言なし、浮いた Promise なし | `npx biome check .` | `biome.jsonc` の `suspicious` / `nursery` |
| `console` を使わない | `npx biome check .` | `biome.jsonc` |
| 認知複雑度は 12 以下 | `npx biome check .` | `biome.jsonc` の `noExcessiveCognitiveComplexity` |
| 相対 import は `.ts` 拡張子付き、パスエイリアスなし | `npx tsc --noEmit` + Node 実行 | `tsconfig.json` |

### 数値制約

| 数値 | 既定 | 検証 | 根拠 |
|---|---|---|---|
| プロンプト注入間隔 | 5ユーザーターン | `test/integration/extension.test.ts` | Claude Code v2.1.88 と同じ |
| full の頻度 | 注入5回に1回 | `test/integration/extension.test.ts` | Claude Code v2.1.88 と同じ |
| slug 再試行 | 初回を含めて10回 | `test/unit/plans.test.ts` | Claude Code v2.1.88 と同じ |

数値は DESIGN.md の互換性方針に戻るための警報線です。変更したら、計測値はテストコメントに、
理由はコミットメッセージに残します。

## 変更時の手順

- Claude 互換の面を変える変更は、先に DESIGN.md の互換性マトリクスと「Claude Code との差」を更新し、
  対応するテストを先に直す。差を増やす変更は理由を残す。
- イベント・ツール・コマンド・ショートカット・フラグを増減する場合は、`test/contract/surface.test.ts` の `EXPECTED_EVENTS` と期待値を先に更新する。1つ落とすと機能が静かに消えるため、契約が変更の入口になる。
- モード遷移・プロンプト注入・承認の意味を変える場合は `test/integration/extension.test.ts` を先に更新し、
  セマンティクスを固定してから実装する。
- プロンプト文面を変える場合は `test/unit/prompts.test.ts` を先に更新し、
  Claude Code の文面との差分が意図的であることを確認する。
- 依存を追加する場合は devDependency のみ可能。`ALLOWED_DEV_DEPENDENCIES` の更新とコミットメッセージの理由をセットで行う。
  実行時依存(`dependencies`)の追加は不可。
- 決定の記録は `docs/adr/` に置く(1決定 = 1ファイル、`NNNN-<topic>.md`)。追加するのは、
  却下した代替を再提案されうる決定、機能や振る舞いを削除・置き換える決定、DESIGN.md / PHILOSOPHY.md に触れる決定のときだけ。
  却下案は結果ではなく理由を書く。
- ツール・コマンド・設定・公開の振る舞いを変える前に `docs/adr/` を読み、却下済みの代替を再提案しない。
  決定が変わったら同じコミットで状態を更新する(採用 → 廃止)。
- カバレッジの数値は契約テストの影響を受けます。契約テストは jiti 経由で `src` をもう一度ロードするため、
  同じファイルが2実体として数えられます。
- ドキュメントの段落内の改行は、文末(。！？)・読点(、)・コロン(:)の直後に置く。

## 手動確認項目(自動検証の対象外)

前提: TUI の実セッションで確認します。注入メッセージは `display: false` のため、画面ではなくセッション記録(`~/.pi/agent/sessions/**.jsonl`)で確認します。

1. `/plan` でステータスに `⏸ plan mode on` が出て、Ctrl+Alt+P で消えること。
2. 「複数ファイルを変更する機能追加」を依頼し、`enter_plan_mode` の同意 → 調査 → プラン作成 → `exit_plan_mode` の承認 → 実装、の順に進むこと。
3. 承認ダイアログで「編集して実行」を選び、編集後の内容で実装が始まること。
4. 「継続」を選び、入力したフィードバックに従ってプランが直ること。
5. 5ユーザーターンを超えるプランセッションで、`plan-mode-context` が再注入されること(初回は full、以降は sparse)。
6. セッション再開で slug とモードが復元され、fork では新しい slug になること。
7. 自動 compaction の後も `plan-mode-context` が注入されること。
8. `pi --print` または `pi --mode json` で `exit_plan_mode` が承認されず、理由が返ること。
