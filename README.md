# 好職雷達

繁體中文職缺篩選器 MVP，使用原生 HTML、CSS 與 JavaScript 製作，無需安裝套件或建置步驟。

## 本機預覽

直接用瀏覽器開啟 `index.html` 即可。使用者新增的職缺與收藏保存在該瀏覽器的 `localStorage`。

## 部署到 Render

專案內的 `render.yaml` 已設定為 Render Static Site：

- Runtime：Static
- Build command：留空
- Publish directory：專案根目錄 (`.`)
- Auto deploy：開啟

將此 repository 推送至 GitHub 後，在 Render 選擇 **New → Blueprint** 並連結 repository，Render 會讀取 `render.yaml` 建立網站。也可以選 **New → Static Site**，將 Publish Directory 設為 `.`，Build Command 留空。

每次推送到部署分支，Render 會自動重新部署。網站資料目前只存在各使用者的瀏覽器；Render 靜態網站不會提供共用資料庫、帳號登入或跨裝置同步。

## 推送到 GitHub

在 GitHub 建立空白 repository，然後在本資料夾執行（替換成自己的 repository URL）：

```powershell
git remote add origin https://github.com/你的帳號/你的repository.git
git push -u origin main
```

