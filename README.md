# 好職雷達

繁體中文職缺篩選器。前端使用原生 HTML/CSS/JavaScript，後端使用 FastAPI 與 SQLAlchemy，職缺資料保存於 PostgreSQL。

## 職缺來源

後端使用勞動力發展署「台灣就業通網站職缺清單」XML 服務，每 12 小時同步一次，每次依來源限制最多取得 1,000 筆。原始職缺連結會保留供使用者前往求職網站查看。

## Render Blueprint

`render.yaml` 維護三個資源：

- `good-job-radar`：既有的靜態前端
- `good-job-radar-api`：Python/FastAPI 服務
- `good-job-radar-db`：PostgreSQL

推送到 GitHub 後，在 Render 的 Blueprint 頁面執行 **Manual Sync**，檢視差異並套用。資料庫連線由 Blueprint 透過 Render 私有連線注入 `DATABASE_URL`。

目前 Blueprint 使用 Render 免費資料庫方案做初次驗證。Render 免費 PostgreSQL 有 1 GB 容量，並會在建立 30 天後到期；要長期保存資料，請在到期前升級到付費方案或先備份／遷移資料。

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
