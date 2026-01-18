🌐 Languages: [English](README.md) | [日本語](README.ja.md)

# 🛒 Shared Shopping List

Cloudflare Workers + KV で動作する、AI搭載の買い物リスト共有アプリ。アカウント不要、URL一つで共有できます。

## 🌟 デモ

- **公開URL**: https://shared-shopping-list.grocery-shopping-list.workers.dev
- **スクリーンショット**:
  <img width="200" height="450" alt="Shared Shopping List" src="https://github.com/user-attachments/assets/8425f181-ce51-444b-9ff4-3b9fd5d83b4f" />
  <img width="200" height="450" alt="Shared Shopping List-1" src="https://github.com/user-attachments/assets/59eab371-ef72-4f7a-bfd2-63f6bab7d8db" />

---

## ✨ 機能一覧

### 🤖 AIショッピングコンシェルジュ
- **自然言語でリスト生成** - 「平日5日分の夕食の買い物リスト」「週末のバーベキューに必要なもの」などのプロンプトから自動生成
- **特売考慮AI** - 現在の特売情報を考慮したリスト生成（オプション）
- **多言語対応** - 日本語、英語など複数言語に対応
- **スマートフォールバック** - レート制限時に自動でバックアップAPIキーに切り替え

### 💰 スマートカタログ統合
- **Woolworths & Coles 特売情報** - オーストラリア主要スーパーのリアルタイム・キャッシュ済み特売情報を取得
- **価格比較** - 店舗間の価格を一目で比較
- **AI商品マッチング** - ユーザー入力とカタログ商品の曖昧マッチング（例: 「牛肉」→「Australian Beef Mince」）
- **節約額計算** - 特売による合計節約額を自動計算

### 🔗 シームレスな共有
- **トークンベースURL** - アカウント不要、ユニークなトークン付きURLで共有
- **リアルタイム同期** - 7秒ごとのポーリングとバージョンベースの競合解決
- **クロスデバイス** - Webブラウザがあればどのデバイスからでもアクセス可能

### 🏷️ 柔軟な整理機能
- **プリセット店舗タグ** - Woolies, Coles, ALDI, IGA, Asian Grocery, Chemist, Kmart
- **カスタムタグ** - 独自のタグを作成（ローカル保存）
- **タグフィルター** - 選択したタグでビューをフィルタリング

### 📱 モバイルファーストUX
- **レスポンシブデザイン** - スマートフォン・タブレット最適化
- **タッチフレンドリー** - 大きなタップターゲットとスワイプ対応UI
- **iOS対応** - ノッチ付きデバイスの適切なパディング
- **オフライン対応** - ネットワーク問題のグレースフル処理

### 💸 コスト効率
- **Cloudflare無料枠** - 完全に無料枠内で運用可能
- **エッジコンピューティング** - Cloudflareエッジネットワークで世界中で低レイテンシ

---

## 🏗️ アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                         フロントエンド                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  index.html (Vanilla JS, モバイルファーストCSS)           │   │
│  │  • リアルタイム同期ショッピングリストUI                    │   │
│  │  • AI生成モーダル                                        │   │
│  │  • 特売ブラウザ (Woolies/Colesタブ)                      │   │
│  │  • 共有モーダル (URLコピー)                               │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Cloudflare Worker (エッジ)                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  worker.js - APIルート                                   │   │
│  │  ├── GET/PUT/DELETE /api/list/:token  (CRUD操作)         │   │
│  │  ├── POST /api/generate               (AIリスト生成)      │   │
│  │  ├── GET  /api/specials               (モック特売)        │   │
│  │  ├── GET  /api/specials-rapidapi      (RapidAPI)         │   │
│  │  ├── GET  /api/search                 (商品検索)          │   │
│  │  ├── POST /api/match                  (カタログマッチ)     │   │
│  │  ├── POST /api/ai-match               (AIマッチング)       │   │
│  │  └── POST /api/filter-specials        (AIフィルター)       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ catalog-api.js │  │catalog-rapidapi │  │catalog-ai-match │   │
│  │ (モックデータ)  │  │ (本番API)       │  │ (AIマッチング)   │   │
│  └────────────────┘  └─────────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐
   │ Cloudflare  │    │ OpenRouter  │    │ RapidAPI        │
   │ KV Storage  │    │ (LLM API)   │    │ (Coles/Woolies) │
   └─────────────┘    └─────────────┘    └─────────────────┘
```

---

## 📁 プロジェクト構造

```
groccery_list_app/
├── index.html              # シングルページフロントエンド (Vanilla JS)
├── public/
│   └── index.html          # デプロイ用静的アセット
├── src/
│   ├── worker.js           # メインCloudflare Worker (APIルート)
│   ├── catalog-api.js      # モックカタログデータ統合
│   ├── catalog-rapidapi.js # RapidAPI統合 (Woolies/Coles)
│   ├── catalog-ai-matcher.js # AI商品マッチング
│   ├── catalog-mock-data.js  # モック特売データ
│   └── catalog-frontend.js   # フロントエンドカタログコンポーネント
├── functions/
│   └── _middleware.js      # Cloudflare Pagesミドルウェア
├── test/
│   ├── worker.test.js      # Worker APIテスト
│   ├── frontend.test.js    # フロントエンドテスト
│   └── setup.js            # テストセットアップ
├── wrangler.toml           # Cloudflare Workers設定
├── package.json            # 依存関係 & スクリプト
└── vitest.config.js        # テスト設定
```

---

## 🔌 APIエンドポイント

| メソッド | エンドポイント | 説明 |
|----------|----------------|------|
| `GET` | `/api/list/:token` | トークンで買い物リストを取得 |
| `PUT` | `/api/list/:token` | 買い物リストを更新（バージョンベースマージ） |
| `DELETE` | `/api/list/:token` | 買い物リストを削除 |
| `POST` | `/api/generate` | プロンプトからAIで買い物リスト生成 |
| `GET` | `/api/specials` | 現在の特売情報を取得（モックデータ） |
| `GET` | `/api/specials-rapidapi` | RapidAPI経由で特売情報を取得 |
| `GET` | `/api/search?q=...` | カタログ内の商品を検索 |
| `POST` | `/api/match` | リストアイテムとカタログをマッチング |
| `POST` | `/api/ai-match` | AI曖昧マッチング |
| `POST` | `/api/filter-specials` | ユーザーリストでAIフィルタリング |

### 例: AI生成リクエスト
```bash
curl -X POST https://your-worker.workers.dev/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "週末のバーベキューに必要なもの", "token": "your-list-token", "useSpecials": true}'
```

---

## 🚀 クイックスタート

### 前提条件
- Node.js 18+
- Cloudflareアカウント（無料枠でOK）
- （オプション）OpenRouter APIキー（AI機能用）
- （オプション）RapidAPI キー（本番カタログデータ用）

### 1. クローン & インストール

```bash
git clone https://github.com/HikaLucaM/groccery_list_app.git
cd groccery_list_app
npm install
```

### 2. Cloudflareセットアップ

```bash
# Cloudflareにログイン
npx wrangler login

# KV名前空間を作成
npx wrangler kv:namespace create SHOPLIST
npx wrangler kv:namespace create SHOPLIST --preview

# 返されたIDでwrangler.tomlを更新
```

### 3. シークレット設定（AI & カタログ機能用）

```bash
# OpenRouter APIキー（AI生成用）
wrangler secret put OPENROUTER_API_KEY

# オプション: フォールバック用バックアップAPIキー
wrangler secret put OPENROUTER_API_KEY_2

# オプション: RapidAPIキー（本番Woolies/Colesデータ用）
wrangler secret put RAPIDAPI_KEY
```

### 4. デプロイ

```bash
# Workerをデプロイ
npm run deploy

# または全てデプロイ (Worker + Pages)
npm run deploy:all
```

### 5. ローカル開発

```bash
# ローカル開発サーバーを起動
npm run dev

# http://localhost:8787 を開く
```

---

## 🧪 テスト

```bash
# 全テストを実行
npm test

# ウォッチモード
npm run test:watch

# カバレッジ付き
npm run test:coverage
```

---

## 🔒 セキュリティ

> ⚠️ **重要**: このプロジェクトはAPIキーを使用します。コントリビュート前に [SECURITY.md](SECURITY.md) をお読みください。

**重要なポイント:**
- APIキーは絶対にGitにコミットしない
- ローカル開発では `.dev.vars` を使用（`.gitignore`に含まれています）
- 本番環境では `wrangler secret put` を使用
- トークンURLはパスワードと同様に扱う

---

## 📚 ドキュメント

| ドキュメント | 説明 |
|--------------|------|
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | ローカル開発セットアップガイド |
| [SECURITY.md](SECURITY.md) | セキュリティベストプラクティス |
| [CATALOG_INTEGRATION.md](CATALOG_INTEGRATION.md) | カタログAPI実装詳細 |
| [RAPIDAPI_SETUP.md](RAPIDAPI_SETUP.md) | RapidAPI設定 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | デプロイ手順 |
| [TESTING.md](TESTING.md) | テストガイド |

---

## 🛠️ 技術スタック

| レイヤー | 技術 |
|----------|------|
| **フロントエンド** | Vanilla JavaScript, CSS3 (モバイルファースト) |
| **バックエンド** | Cloudflare Workers (エッジランタイム) |
| **ストレージ** | Cloudflare KV |
| **AI** | OpenRouter API (デフォルト: Llama 3 70B) |
| **カタログAPI** | RapidAPI (Woolies/Coles) |
| **テスト** | Vitest, jsdom |
| **デプロイ** | Wrangler CLI |

---

## 📄 ライセンス

[MIT](LICENSE)

## 🤝 コントリビューション

プルリクエスト歓迎！まず [SECURITY.md](SECURITY.md) をお読みください。

## 📮 連絡先

バグ報告、機能リクエスト、質問は [Issues](https://github.com/HikaLucaM/groccery_list_app/issues) からどうぞ。
