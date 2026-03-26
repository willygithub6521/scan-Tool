import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from data_fetcher import get_historical_data, get_basic_info, get_fmp_screener_tickers
from indicators import add_sma, add_ema, add_rsi, add_macd, add_bollinger_bands, add_atr
import io
import os
from dotenv import load_dotenv

# 載入 .env 檔案中的環境變數
load_dotenv()

st.set_page_config(page_title="Stock Scanner Tool PRO", layout="wide")

st.title("📈 Stock Scanner Tool (Phase 3 + Screener API)")

# --- Sidebar ---
st.sidebar.header("配置與輸入")

# 資料來源選擇
data_source = st.sidebar.selectbox("資料來源", ["Yahoo Finance", "FMP"])
fmp_api_key = ""
if data_source == "FMP":
    # 優先從環境變數 (.env) 讀取，若無則從 st.secrets 讀取
    default_key = os.getenv("FMP_API_KEY", "")
    if not default_key:
        try:
            default_key = st.secrets.get("FMP_API_KEY", "")
        except Exception:
            pass
            
    fmp_api_key = st.sidebar.text_input("FMP API Key", value=default_key, type="password", help="請輸入 Financial Modeling Prep 提供的 API Key")
    
    if not fmp_api_key:
        st.sidebar.warning("需要輸入 FMP API Key 才能取得資料！")

# 支持多種輸入方式
input_methods = ["手動輸入", "CSV 上傳"]
if data_source == "FMP":
    input_methods.append("FMP 伺服器端進階篩選")
    
input_method = st.sidebar.radio("目標股票產生方式", input_methods)

tickers = []
if input_method == "手動輸入":
    tickers_input = st.sidebar.text_area("輸入股票代碼 (逗號或換行分隔)", "AAPL\nMSFT\nGOOGL\nNVDA\nTSLA")
    tickers_input_clean = tickers_input.replace('\n', ',')
    tickers = [t.strip().upper() for t in tickers_input_clean.split(",") if t.strip()]
    
elif input_method == "CSV 上傳":
    uploaded_file = st.sidebar.file_uploader("上傳含有股票代碼的 CSV 檔案 (第一欄必須為代碼)", type=["csv"])
    if uploaded_file is not None:
        try:
            df_upload = pd.read_csv(uploaded_file, header=None)
            tickers = [str(t).strip().upper() for t in df_upload.iloc[:, 0].dropna().tolist() if str(t).strip()]
        except Exception as e:
            st.sidebar.error("讀取檔案失敗，請確保是有效的 CSV 檔案！")
            
elif input_method == "FMP 伺服器端進階篩選":
    st.sidebar.markdown("---")
    st.sidebar.subheader("API 篩選參數 (Server-Side)")
    col_mc1, col_mc2 = st.sidebar.columns(2)
    mkt_cap_min = col_mc1.number_input("最低市值(M)", value=1.0, step=1.0, min_value=0.0)
    mkt_cap_max = col_mc2.number_input("最高市值(M)", value=500.0, step=50.0, min_value=0.0)
    
    col_p1, col_p2 = st.sidebar.columns(2)
    price_more_than = col_p1.number_input("股價大於 ($)", value=1.0, step=1.0, min_value=0.0)
    price_lower_than = col_p2.number_input("股價小於 ($)", value=50.0, step=1.0, min_value=0.0)
    
    col_v1, col_v2 = st.sidebar.columns(2)
    vol_min = col_v1.number_input("最低交易量(萬)", value=10.0, step=10.0, min_value=0.0)
    vol_max = col_v2.number_input("最高交易量(萬)", value=200.0, step=50.0, min_value=0.0)
    
    sector = st.sidebar.selectbox("Sector (大板塊)", ["", "Technology", "Healthcare", "Financial Services", "Energy", "Consumer Cyclical"])
    industry_list = ["", "Semiconductors", "Software - Infrastructure", "Consumer Electronics", "Banks - Diversified", "Biotechnology"]
    industry = st.sidebar.selectbox("Industry (細分產業)", industry_list)
    limit = st.sidebar.slider("最大返回數量", 10, 1000, 30)
    st.sidebar.markdown("---")
    
    if fmp_api_key:
        st.session_state["fmp_server_params"] = {
            "marketCapMoreThan": int(mkt_cap_min * 1e6),
            "marketCapLowerThan": int(mkt_cap_max * 1e6) if mkt_cap_max > 0 else 0,
            "priceMoreThan": price_more_than,
            "priceLowerThan": price_lower_than if price_lower_than > 0 else 0,
            "volumeMoreThan": int(vol_min * 10000),
            "volumeLowerThan": int(vol_max * 10000) if vol_max > 0 else 0,
            "sector": sector,
            "industry": industry,
            "limit": limit
        }
    else:
        st.sidebar.warning("請先於上方輸入 FMP API Key。")


period = st.sidebar.selectbox("資料期間", ["1mo", "3mo", "6mo", "1y", "2y", "5y", "max"], index=3)

st.sidebar.subheader("第二階段：技術面篩選條件 (Client-Side)")
sma_window = st.sidebar.number_input("SMA 天數", value=50, step=5)
rsi_limit = st.sidebar.number_input("RSI 上限 (找超賣)", value=30, step=5)
bb_window = st.sidebar.number_input("布林通道天數", value=20, step=1)

st.sidebar.subheader("第三階段：漲跌幅篩選條件 (Client-Side)")
min_1d_return = st.sidebar.number_input("單日最低漲幅 (%)", value=-100.0, step=1.0)
n_days_return = st.sidebar.number_input("前 N 日區間 (天)", value=5, min_value=1, step=1)
min_nd_return = st.sidebar.number_input(f"{n_days_return}日最低漲幅 (%)", value=-100.0, step=1.0)

st.sidebar.subheader("第四階段：嚴格過濾")
strict_return_filter = st.sidebar.checkbox("只顯示【漲跌幅】達標的股票", value=False)

st.sidebar.markdown("---")
start_scan = st.sidebar.button("開始統一搜尋 🚀", use_container_width=True)

# 初始化 Session State
if "scan_results" not in st.session_state:
    st.session_state["scan_results"] = []
    st.session_state["raw_data_dict"] = {}

# --- Main App ---
# 只有在初次未掃描且準備要執行時才檢查
if not start_scan and not st.session_state.get("scan_results"):
    st.info("👈 請在左側輸入代碼或進行條件設定，並點擊「開始統一搜尋🚀」以開始。")
    st.stop()
    
if data_source == "FMP" and not fmp_api_key:
    st.error("您選擇了 FMP 作為資料來源，但尚未提供 API Key。請在左側欄輸入。")
    st.stop()

if start_scan:
    # 統一再這裡抓取 FMP 伺服器進階篩選清單
    if input_method == "FMP 伺服器端進階篩選":
        with st.spinner("📡 正在向 FMP 請求符合條件的標的..."):
            tickers = get_fmp_screener_tickers(fmp_api_key, st.session_state.get("fmp_server_params", {}))
        if not tickers:
            st.warning("API 篩選找不到任何股票或發生錯誤。請放寬條件！")
            st.stop()
        else:
            st.success(f"成功透過 API 取得 {len(tickers)} 檔股票！準備開始深度分析。")
            
    if not tickers:
        st.warning("未提供任何股票代碼。")
        st.stop()

if start_scan:
    import concurrent.futures
    st.write(f"**準備進行多執行緒技術分析 ({len(tickers)} 檔)**...")
    my_bar = st.progress(0, text="準備並行處理...")
    table_placeholder = st.empty()
    
    temp_results = []
    temp_raw = {}
    completed = 0
    total = len(tickers)
    
    def process_single_ticker(ticker):
        try:
            df = get_historical_data(ticker, data_source, "max", fmp_api_key)
            if df.empty:
                return None
            
            df = add_sma(df, window=sma_window)
            df = add_rsi(df, window=14)
            df = add_macd(df)
            df = add_bollinger_bands(df, window=bb_window)
            df = add_atr(df, window=14)
            
            df['Return_1d'] = df['Close'].pct_change(1) * 100
            df[f'Return_{n_days_return}d'] = df['Close'].pct_change(n_days_return) * 100
            
            days_map = {"1mo": 22, "3mo": 66, "6mo": 130, "1y": 252, "2y": 504, "5y": 1260, "max": 5000}
            timeseries = days_map.get(period, 5000)
            if len(df) > timeseries:
                df = df.tail(timeseries)
            
            latest_data = df.iloc[-1]
            
            # 日期過期檢查：排除下市或太老的資料 (超過 7 天視為舊資料)
            if pd.Timestamp(latest_data.name) < pd.Timestamp.now() - pd.Timedelta(days=7):
                return None
                
            info = get_basic_info(ticker, data_source, fmp_api_key)
            company_name = info.get('shortName', ticker)
            sector_info = info.get('sector', 'N/A')
            
            cond_price_sma = latest_data['Close'] > latest_data[f'SMA_{sma_window}']
            cond_rsi = latest_data['RSI_14'] < rsi_limit
            cond_bb_lower = latest_data['Close'] < latest_data[f'BB_Lower_{bb_window}']
            cond_return_1d = latest_data['Return_1d'] >= min_1d_return
            cond_return_nd = latest_data[f'Return_{n_days_return}d'] >= min_nd_return
            
            # 移除提早結束的過濾，保存過濾布林值至 dict 中，稍後端看 checkbox 即時呈現在 UI 上
            is_strict_passed = bool(cond_return_1d and cond_return_nd)
            
            result_dict = {
                "Ticker": ticker,
                "Name": company_name,
                "Sector": sector_info,
                "Close": round(latest_data['Close'], 2),
                f"SMA_{sma_window}": round(latest_data[f'SMA_{sma_window}'], 2),
                "RSI_14": round(latest_data['RSI_14'], 2),
                f"BB_Lower_{bb_window}": round(latest_data[f'BB_Lower_{bb_window}'], 2),
                "ATR_14": round(latest_data['ATR_14'], 2),
                "1日漲幅(%)": round(latest_data['Return_1d'], 2),
                f"{n_days_return}日漲幅(%)": round(latest_data[f'Return_{n_days_return}d'], 2),
                "Price > SMA": "✅" if cond_price_sma else "❌",
                "RSI < Limit": "✅" if cond_rsi else "❌",
                "Price < BB Lower": "✅" if cond_bb_lower else "❌",
                "1日漲幅達標": "✅" if cond_return_1d else "❌",
                f"{n_days_return}日漲幅達標": "✅" if cond_return_nd else "❌",
                "_PassStrict": is_strict_passed
            }
            return {"ticker": ticker, "df": df, "result_dict": result_dict}
        except Exception:
            return None

    # 使用 ThreadPoolExecutor 並行抓取與運算
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        future_to_ticker = {executor.submit(process_single_ticker, t): t for t in tickers}
        for future in concurrent.futures.as_completed(future_to_ticker):
            completed += 1
            res = future.result()
            if res:
                temp_results.append(res["result_dict"])
                temp_raw[res["ticker"]] = res["df"]
            
            # 每累積處理 10 檔或最後一檔時，更新即時顯示 Table
            if completed % 10 == 0 or completed == total:
                my_bar.progress(completed / total, text=f"並行運算中: {completed}/{total} (發現 {len(temp_results)} 檔過關)")
                if temp_results:
                    df_live = pd.DataFrame(temp_results)
                    if strict_return_filter and "_PassStrict" in df_live.columns:
                        df_live = df_live[df_live["_PassStrict"]]
                        
                    if "_PassStrict" in df_live.columns:
                        df_live = df_live.drop(columns=["_PassStrict"])
                        
                    table_placeholder.dataframe(df_live, use_container_width=True)
                    
    # 將完成結果存入 session_state，讓換頁或排序時不需要重跑
    st.session_state["scan_results"] = temp_results
    st.session_state["raw_data_dict"] = temp_raw
    my_bar.empty()
    table_placeholder.empty()

results = st.session_state.get("scan_results", [])
raw_data_dict = st.session_state.get("raw_data_dict", {})

if not results:
    st.warning("請設定篩選條件後，點擊左側最下方「開始統一搜尋」按鈕。若已搜尋，可能是未發現符合條件的股票。")
    st.stop()

results_df = pd.DataFrame(results)

# 實踐「嚴格過濾」機制：即時更新 Table！
if strict_return_filter and not results_df.empty:
    results_df = results_df[results_df["_PassStrict"]]
    if results_df.empty:
        st.warning(f"啟用嚴格過濾後，目前 {len(results)} 檔掃描完成的股票中，沒有任何一檔符合漲幅達標的限制。")
        st.stop()

# 為了畫面整潔，移除內部追蹤用欄位
if "_PassStrict" in results_df.columns:
    results_df = results_df.drop(columns=["_PassStrict"])

# 更新可用於下拉選單的標的清單
available_tickers = results_df["Ticker"].tolist()

tab1, tab2, tab3 = st.tabs(["📊 篩選結果 (Screener)", "📈 圖表分析 (Interactive Charts)", "🗄️ 原始資料 (Raw Data)"])

with tab1:
    st.subheader("分析結果總表")
    csv = results_df.to_csv(index=False).encode('utf-8-sig')
    st.download_button(
        label="📥 匯出結果 (CSV)",
        data=csv,
        file_name='screener_results.csv',
        mime='text/csv',
    )
    st.dataframe(results_df, use_container_width=True)

with tab2:
    st.subheader("個股技術線圖與指標")
    col1, col2 = st.columns([1, 3])
    with col1:
        selected_ticker = st.selectbox("選擇股票代碼", available_tickers)
        show_bb = st.checkbox("顯示布林通道", value=True)
        show_sma = st.checkbox(f"顯示 SMA ({sma_window})", value=True)
        
    with col2:
        chart_df = raw_data_dict[selected_ticker]
        fig = go.Figure()
        fig.add_trace(go.Candlestick(x=chart_df.index,
                    open=chart_df['Open'], high=chart_df['High'],
                    low=chart_df['Low'], close=chart_df['Close'],
                    name='K線', increasing_line_color='cyan', decreasing_line_color='gray'))
        
        if show_sma:
            fig.add_trace(go.Scatter(x=chart_df.index, y=chart_df[f'SMA_{sma_window}'], 
                                     line=dict(color='orange', width=2), name=f'SMA {sma_window}'))
        
        if show_bb:
            fig.add_trace(go.Scatter(x=chart_df.index, y=chart_df[f'BB_Upper_{bb_window}'], 
                                     line=dict(color='rgba(255,255,255,0.3)', width=1, dash='dot'), name='BB上軌'))
            fig.add_trace(go.Scatter(x=chart_df.index, y=chart_df[f'BB_Lower_{bb_window}'], 
                                     line=dict(color='rgba(255,255,255,0.3)', width=1, dash='dot'), 
                                     fill='tonexty', fillcolor='rgba(255,255,255,0.05)', name='BB下軌'))
                                 
        fig.update_layout(title=f"{selected_ticker} 歷史價格走勢", yaxis_title="股價",
                          xaxis_rangeslider_visible=False, template="plotly_dark",
                          height=600, margin=dict(l=20, r=20, t=50, b=20))
        st.plotly_chart(fig, use_container_width=True)

with tab3:
    st.subheader("檢視詳細運算資料")
    raw_ticker = st.selectbox("選擇要檢視歷史列的股票", available_tickers, key="raw_select")
    raw_df = raw_data_dict[raw_ticker]
    st.dataframe(raw_df.tail(252).sort_index(ascending=False), use_container_width=True)
