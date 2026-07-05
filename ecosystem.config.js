module.exports = {
  apps: [
    {
      name: "scan-tool-backend",
      // 使用虛擬環境中的 uvicorn 啟動 FastAPI，並帶上 --reload
      script: "venv\\Scripts\\uvicorn.exe",
      args: "main_api:app --reload",
      cwd: "c:\\workspace\\scan-Tool",
      // 因為已經使用 --reload，所以關閉 PM2 內建的 watch 功能
      watch: false
    },
    {
      name: "scan-tool-frontend",
      script: "node_modules\\vite\\bin\\vite.js",	
      cwd: "c:\\workspace\\scan-Tool\\frontend",
      watch: false
    }
  ]
};
