# 使用官方 Python 輕量級影像
FROM python:3.10-slim

# 設定工作目錄
WORKDIR /app

# 複製 requirements.txt 並安裝相依套件
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製專案程式碼
COPY . .

# 暴露 Streamlit 預設 Port
EXPOSE 8501

# 確保 Streamlit 伺服器正確綁定 IP
ENV Streamlit_SERVER_PORT=8501
ENV Streamlit_SERVER_ADDRESS=0.0.0.0

# 啟動指令
ENTRYPOINT ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]
