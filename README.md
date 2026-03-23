# 📈 Stock Scanner Tool PRO

一個基於 Python 和 Streamlit 建立的強大互動式股票篩選與技術分析工具。支援透過 Yahoo Finance 或 Financial Modeling Prep (FMP) API 取得即時與歷史市場資料。

## 🌟 核心特色
- **雙資料來源支援**：自由切換免費的 Yahoo Finance 或是專業的 FMP API。
- **多條件技術分析**：內建 SMA、EMA、RSI、MACD、布林通道 (Bollinger Bands) 與 ATR 等指標運算。
- **伺服器端進階篩選**：透過 FMP Screener API，可直接於伺服器端依據市值、股價範圍、產業分類進行第一層過濾。
- **多種輸入方式**：支援手動輸入代碼、上傳 CSV 檔案批次匯入，或是 API 篩選。
- **視覺化圖表與匯出**：內建 Plotly 互動式 K 線圖與指標疊加，並支援一鍵將分析結果匯出為 CSV。

## 🚀 快速開始

### 1. 環境建置
確保您的系統已安裝 Python 3.10+。
```bash
# 切換至專案目錄
cd C:\workspace\scanTool

# 建立虛擬環境
python -m venv venv

# 啟動虛擬環境 (Windows)
.\venv\Scripts\activate
# 啟動虛擬環境 (macOS/Linux)
# source venv/bin/activate

# 安裝所需套件
pip install -r requirements.txt
```

### 2. 啟動應用程式
```bash
streamlit run app.py
```
執行後，瀏覽器將自動開啟 `http://localhost:8501`。

### 3. 設定 FMP API (選擇性)
若要使用 FMP 作為資料來源，請先註冊 [Financial Modeling Prep](https://financialmodelingprep.com/) 取得 API Key。
您可以在側邊欄直接輸入 Key，或者在專案根目錄建立 `.streamlit/secrets.toml` 檔案：
```toml
FMP_API_KEY = "您的_API_KEY_在這裡"
```

## 🐳 Docker 容器化部署
專案內附 `Dockerfile`，可輕鬆容器化：
```bash
# 建立 Image
docker build -t stock-scanner-tool .

# 執行 Container
docker run -p 8501:8501 stock-scanner-tool
```

## ☁️ 部署至 Streamlit Community Cloud
1. 將此專案上傳至您的 GitHub 儲存庫。
2. 登入 [Streamlit Community Cloud](https://share.streamlit.io/) 並連結您的 GitHub 帳號。
3. 選擇 `app.py` 作為起點進行部署。
4. 在部署設定中的 "Advanced settings" -> "Secrets" 貼上您的 API Key 以啟用 FMP 支持。
