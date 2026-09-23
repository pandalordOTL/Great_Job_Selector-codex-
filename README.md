# 好職雷達

繁體中文職缺篩選器。前端使用原生 HTML/CSS/JavaScript，後端使用 FastAPI 與 SQLAlchemy，職缺資料保存於 PostgreSQL。

## 職缺來源

後端使用勞動力發展署「台灣就業通網站職缺清單」XML 服務，每 12 小時同步一次，每次依來源限制最多取得 1,000 筆。原始職缺連結會保留供使用者前往求職網站查看。

## Render Blueprint

`render.yaml` 維護兩個 Render 資源：

- `good-job-radar`：既有的靜態前端
- `good-job-radar-api`：Python/FastAPI 服務

職缺資料庫使用 Neon PostgreSQL。推送到 GitHub 後，在 Neon 建立一個 PostgreSQL 專案，選擇離 Render API 最近的區域，複製連線字串。到 Render 的 `good-job-radar-api` 服務設定 **Environment → Add Environment Variable**，新增 `DATABASE_URL` 並貼上 Neon 連線字串，儲存後重新部署。連線字串只放在 Render 環境變數，不要提交到 GitHub。FastAPI 啟動時會自動建立資料表並同步職缺。

在 Render 的 Blueprint 頁面執行 **Manual Sync**，檢視變更並套用。若先前已建立 `good-job-radar-db` Render Postgres，它不會因為從 Blueprint 移除而自動刪除；確認 Neon 連線成功後，可在 Render Dashboard 手動刪除閒置的 Render 資料庫。

Neon Free 方案有儲存空間、運算時數和流量上限；留意 Neon 控制台用量，並確認帳戶中的方案與額度。

## 本機開發

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn api:app --reload
```

本機預設使用 `./good_job_radar.db` SQLite。網站前端的 API URL 設於 `app.js` 的 `API_BASE`。

## 目前資料保存範圍

來源職缺儲存在 PostgreSQL，會由後端同步；收藏與求職狀態仍保存在瀏覽器本機，尚未加入帳號登入與跨裝置同步。職缺適合度是可解釋的規則分數，並非雇主或求職網站提供的評估。

使用者可在「調整我的條件」設定最低月薪、周休二日偏好與產業，前端會依三項條件的平均符合度計算 1–10 分。個人偏好存在該瀏覽器的 `localStorage`。休假資訊由職缺文字辨識，產業由職稱、職務類別、公司名稱與描述推估；缺少資訊的條件以中間分數處理，並在卡片上註明。
