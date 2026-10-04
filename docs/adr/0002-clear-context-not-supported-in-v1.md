# ADR 0002: コンテキストクリア承認は v1 で対応しない

- 状態: 採用
- 日付: 2026-10-04
- 対象: `exit_plan_mode` 承認時のセッション操作

## 背景

- Claude Code は承認時にコンテキストクリアを選べる。選ぶと計画のコンテキストを捨て、新しいセッションで「Implement the following plan: <plan>」から実装を始める。
- Pi のセッション操作(`ctx.newSession()` / `ctx.fork()` / `ctx.navigateTree()`)は `ExtensionCommandContext` にだけあり、ツールの `execute()` からは呼べない。
- 代替として、コマンド `/plan execute` を追加し、承認後に `navigateTree(root, { summarize: false })` でルートへ移動してプランを注入する案を検討した。

## 決定

1. v1 の承認は `Yes, execute the plan` / `Edit the plan, then execute` / `No, keep planning` の三択とし、コンテキストはクリアしない。
2. 実装は現在のコンテキストで続ける。プランは承認結果として tool_result に含まれる(プランが空のときは短い承認文だけ)。
3. 将来、コマンド経由のコンテキストクリアを検討するときは、この決定を見直す。

## 理由

- ツールの実行からセッション操作を呼べない Pi の制約による差である。
- コンテキストをクリアしなくても、承認済みプラン全文がモデルへ返るため実装はできる。
- コマンドとツールの2経路に承認を分けると、承認 UI と状態遷移が二重になる。v1 では複雑さに見合う価値がない。

## 帰結

- 長い計画セッションでは、実装フェーズも同じコンテキストを引き継ぐ。トークン消費は Claude Code より増える。
- Claude Code の「clear context + auto」に相当する選択肢は出さない。[README](../../README.md) と [DESIGN.md](../../DESIGN.md) に差として記録する。

## 代替案

| 代替 | 却下理由 |
|---|---|
| `/plan execute` コマンドと `navigateTree` でルートへ戻る | 承認経路が2つになり、状態遷移とテストが倍になる。v1 の価値を超える |
| `ctx.fork()` で新しいセッションを作る | 承認経路と状態遷移が二重になり、fork 先へプランを渡す経路も新設する必要がある |
