import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from data_fetcher import get_historical_data, get_basic_info, get_fmp_screener_tickers, get_aftermarket_quote, get_stock_news
from indicators import add_sma, add_ema, add_rsi, add_macd, add_bollinger_bands, add_atr
import io
import os
import numpy as np

st.set_page_config(page_title="Stock Scanner Tool PRO", layout="wide")

st.title("📈 Stock Scanner Tool (Phase 3 + Screener API)")

# --- Sidebar ---
st.sidebar.header("配置與輸入")

# 資料來源選擇
data_source = st.sidebar.selectbox("資料來源", ["Yahoo Finance", "FMP"])
fmp_api_key = ""
if data_source == "FMP":
    # 統一使用 Streamlit 官方推薦的 st.secrets 讀取金鑰 (無縫支援 Streamlit Cloud)
    try:
        default_key = st.secrets.get("FMP_API_KEY", "")
    except Exception:
        default_key = ""
            
    fmp_api_key = st.sidebar.text_input("FMP API Key", value=default_key, type="password", help="請輸入 Financial Modeling Prep 提供的 API Key。本機開發請配置於 .streamlit/secrets.toml")
    
    if not fmp_api_key:
        st.sidebar.warning("需要填寫 FMP API Key 才能取得資料！")

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
    with st.sidebar.expander("API 篩選參數 (Server-Side)", expanded=True):
        col_mc1, col_mc2 = st.columns(2)
        mkt_cap_min = col_mc1.number_input("最低市值(M)", value=1.0, step=1.0, min_value=0.0)
        mkt_cap_max = col_mc2.number_input("最高市值(M)", value=500.0, step=50.0, min_value=0.0)
        
        col_p1, col_p2 = st.columns(2)
        price_more_than = col_p1.number_input("股價大於 ($)", value=1.0, step=1.0, min_value=0.0)
        price_lower_than = col_p2.number_input("股價小於 ($)", value=50.0, step=1.0, min_value=0.0)
        
        col_v1, col_v2 = st.columns(2)
        vol_min = col_v1.number_input("最低交易量(萬)", value=10.0, step=10.0, min_value=0.0)
        vol_max = col_v2.number_input("最高交易量(萬)", value=200.0, step=50.0, min_value=0.0)
        
        sector = st.selectbox("Sector (大板塊)", ["", "Technology", "Healthcare", "Financial Services", "Energy", "Consumer Cyclical", "Industrials", "Consumer Defensive", "Basic Materials", "Utilities", "Real Estate", "Communication Services"])
        industry_list = ["", "Semiconductors", "Software - Infrastructure", "Consumer Electronics", "Banks - Diversified", "Biotechnology"]
        industry = st.selectbox("Industry (細分產業)", industry_list)
        limit = st.slider("最大返回數量", 10, 1000, 30)
        st.markdown("---")
        
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
            st.warning("請先於上方輸入 FMP API Key。")


period = st.sidebar.selectbox("資料期間", ["1mo", "3mo", "6mo", "1y", "2y", "5y", "max"], index=5)

with st.sidebar.expander("技術指標篩選 (Client-Side)", expanded=False):
    sma_window = st.number_input("SMA 天數", value=50, step=5)
    # rsi_limit = st.number_input("RSI 上限 (找超賣)", value=30, step=5)
    # bb_window = st.number_input("布林通道天數", value=20, step=1)

with st.sidebar.expander("動能漲幅與爆量篩選 (Client-Side)", expanded=True):
    min_1d_return = st.number_input("單日最低漲幅 (%)", value=-100.0, step=1.0)
    n_days_return = st.number_input("前 N 日區間 (天)", value=5, min_value=1, step=1)
    min_nd_return = st.number_input(f"{n_days_return}日最低漲幅 (%)", value=-100.0, step=1.0)

    match_logic = st.radio("漲跌幅條件交集 logic", ["OR (任一條件達標即可)", "AND (全部條件皆須達標)"], index=0)
    strict_return_filter = st.checkbox("啟用嚴格過濾 (只顯示漲勢達標)", value=False)
    
    st.markdown("---")
    vol_multiplier = st.number_input("RVOL 異常倍數 (今量 vs 20日均量)", value=20.0, step=1.0)
    strict_vol_filter = st.checkbox("啟用爆量過濾 (只顯示爆量達標)", value=False)

st.sidebar.markdown("---")
start_scan = st.sidebar.button("開始統一搜尋 🚀", use_container_width=True)

# 初始化 Session State
if "scan_results" not in st.session_state:
    st.session_state["scan_results"] = []
    st.session_state["raw_data_dict"] = {}
if "saved_history" not in st.session_state:
    st.session_state["saved_history"] = {}

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
    st.session_state["ticker_info_cache"] = {}
    if input_method == "FMP 伺服器端進階篩選":
        with st.spinner("📡 正在向 FMP 請求符合條件的標的..."):
            screener_results = get_fmp_screener_tickers(fmp_api_key, st.session_state.get("fmp_server_params", {}))
            tickers = [item["symbol"] for item in screener_results if "symbol" in item]
            for item in screener_results:
                if "symbol" in item:
                    st.session_state["ticker_info_cache"][item["symbol"]] = {
                        "shortName": item.get("companyName", item["symbol"]),
                        "sector": item.get("sector", "N/A")
                    }
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
            df = get_historical_data(ticker, data_source, period, fmp_api_key)
            if df.empty:
                return None
            
            df = add_sma(df, window=sma_window)
            # df = add_rsi(df, window=14)
            # df = add_macd(df)
            # df = add_bollinger_bands(df, window=bb_window)
            # df = add_atr(df, window=14)
            
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
                
            ticker_cache = st.session_state.get("ticker_info_cache", {})
            if ticker in ticker_cache:
                info = ticker_cache[ticker]
            else:
                info = get_basic_info(ticker, data_source, fmp_api_key)
            
            company_name = info.get('shortName', ticker)
            sector_info = info.get('sector', 'N/A')
            
            cond_price_sma = latest_data['Close'] > latest_data[f'SMA_{sma_window}']
            # cond_rsi = latest_data['RSI_14'] < rsi_limit
            # cond_bb_lower = latest_data['Close'] < latest_data[f'BB_Lower_{bb_window}']
            cond_return_1d = latest_data['Return_1d'] >= min_1d_return
            cond_return_nd = latest_data[f'Return_{n_days_return}d'] >= min_nd_return
            
            # 我們保留初始紀錄，但不依賴它作為最終輸出 (因 UI 改動會全自動復寫)
            is_strict_passed = bool(cond_return_1d or cond_return_nd)
            
            result_dict = {
                "Ticker": ticker,
                "Name": company_name,
                "Sector": sector_info,
                "Close": round(latest_data['Close'], 2),
                f"SMA_{sma_window}": round(latest_data[f'SMA_{sma_window}'], 2),
                "Price > SMA": "✅" if cond_price_sma else "❌",
                "1日漲幅(%)": round(latest_data['Return_1d'], 2),
                f"{n_days_return}日漲幅(%)": round(latest_data[f'Return_{n_days_return}d'], 2),
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
# 解耦：當使用者在側邊欄調整 N 日、或漲幅下限時，直接重新計算並覆寫 dataframe
if not results_df.empty and raw_data_dict:
    cols_to_drop = [c for c in results_df.columns if "漲幅" in c or "_PassStrict" in c or "爆量" in c or "RVOL" in c]
    results_df = results_df.drop(columns=cols_to_drop, errors='ignore')
    
    ret_1d_list, ret_nd_list, pass_1d_list, pass_nd_list, pass_strict_list, pass_vol_list, rvol_list = [], [], [], [], [], [], []
    
    for _, row in results_df.iterrows():
        ticker = row["Ticker"]
        df = raw_data_dict.get(ticker)
        
        if df is not None and not df.empty:
            r1 = (df['Close'].iloc[-1] / df['Close'].iloc[-2] - 1) * 100 if len(df) >= 2 else 0.0
            rn = (df['Close'].iloc[-1] / df['Close'].iloc[-1 - n_days_return] - 1) * 100 if len(df) >= n_days_return + 1 else 0.0
            
            vol_sma_20 = df['Volume'].rolling(window=20).mean().iloc[-1] if len(df) >= 20 else 0
            vol_today = df['Volume'].iloc[-1]
            rvol = (vol_today / vol_sma_20) if vol_sma_20 > 0 else 0.0
            cond_vol = rvol >= vol_multiplier
            
            cond_1d, cond_nd = r1 >= min_1d_return, rn >= min_nd_return
            is_strict = (cond_1d or cond_nd) if "OR" in match_logic else (cond_1d and cond_nd)
            
            ret_1d_list.append(round(r1, 2))
            ret_nd_list.append(round(rn, 2))
            pass_1d_list.append("✅" if cond_1d else "❌")
            pass_nd_list.append("✅" if cond_nd else "❌")
            pass_strict_list.append(is_strict)
            pass_vol_list.append("✅" if cond_vol else "❌")
            rvol_list.append(round(rvol, 2))
        else:
            ret_1d_list.append(0.0)
            ret_nd_list.append(0.0)
            pass_1d_list.append("❌")
            pass_nd_list.append("❌")
            pass_strict_list.append(False)
            pass_vol_list.append("❌")
            rvol_list.append(0.0)
            
    results_df["1日漲幅(%)"] = ret_1d_list
    results_df[f"{n_days_return}日漲幅(%)"] = ret_nd_list
    results_df["1日漲幅達標"] = pass_1d_list
    results_df[f"{n_days_return}日漲幅達標"] = pass_nd_list
    results_df["RVOL (倍)"] = rvol_list
    results_df["爆量達標"] = pass_vol_list
    results_df["_PassStrict"] = pass_strict_list
    results_df["_PassStrictVol"] = [ v == "✅" for v in pass_vol_list ]

if strict_return_filter and not results_df.empty:
    results_df = results_df[results_df["_PassStrict"]]
    if results_df.empty:
        st.warning(f"啟用嚴格過濾後，目前 {len(results)} 檔掃描完成的股票中，沒有任何一檔符合條件。")
        st.stop()

if strict_vol_filter and not results_df.empty:
    results_df = results_df[results_df["_PassStrictVol"]]
    if results_df.empty:
        st.warning(f"啟用爆量過濾後，查無任何符合倍數條件的爆量股票。")
        st.stop()

# 為了畫面整潔，移除內部追蹤用欄位
cols_to_drop_final = [c for c in results_df.columns if "_PassStrict" in c]
results_df = results_df.drop(columns=cols_to_drop_final, errors='ignore')

# 更新可用於下拉選單的標的清單
available_tickers = results_df["Ticker"].tolist()

tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs(["📊 篩選結果 (Screener)", "📈 圖表分析 (Interactive Charts)", "🗄️ 原始資料 (Raw Data)", "🔥 潛在股深度解析 (Watchlist)", "🗂️ 歷史庫存 (Saved Scans)", "🧪 策略回測 (Backtest)", "🤖 專業事件回測 (Backtrader)"])

with tab1:
    st.subheader("分析結果總表")
    col_a, col_b = st.columns([1, 1])
    with col_a:
        csv = results_df.to_csv(index=False).encode('utf-8-sig')
        st.download_button(
            label="📥 匯出結果 (CSV)",
            data=csv,
            file_name='screener_results.csv',
            mime='text/csv',
        )
    with col_b:
        if st.button("💾 儲存本次結果至無塵歷史庫存", use_container_width=True):
            import datetime
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            st.session_state["saved_history"][now_str] = results_df.copy()
            st.success(f"已成功將 {len(results_df)} 檔潛在股儲存至「歷史庫存」標籤頁！")
            
    st.dataframe(results_df, use_container_width=True)

with tab2:
    st.subheader("個股技術線圖與指標")
    col1, col2 = st.columns([1, 3])
    with col1:
        selected_ticker = st.selectbox("選擇股票代碼", available_tickers)
        show_bb = st.checkbox("顯示布林通道", value=False)
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
        
        if show_bb and f'BB_Upper_{bb_window}' in chart_df.columns:
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

with tab4:
    st.subheader("進階觀察清單 (盤後報價與最新新聞)")
    st.markdown("針對第一階段已經成為潛在飆股的標的，進行第二步的**深度解析 (Deep Dive)** 獲取盤後與催化劑資訊。")
    if not available_tickers:
        st.info("目前沒有符合篩選條件的潛在股。")
    else:
        selected_watchlist = st.selectbox("選擇要深度解析的潛在股", available_tickers, key="watchlist_select")
        
        if st.button(f"🔍 載入 {selected_watchlist} 進階資訊", key=f"fetch_deep_{selected_watchlist}"):
            with st.spinner(f"正在拉取 {selected_watchlist} 的盤後數據與新聞..."):
                quote = get_aftermarket_quote(selected_watchlist, data_source, fmp_api_key)
                news_list = get_stock_news(selected_watchlist, data_source, fmp_api_key, limit=3)

                st.markdown(f"### 🌙 盤後報價 (After-Market)")
                if quote and "Error" not in str(quote) and "change" in quote:
                    price = round(quote.get("price", 0.0), 2)
                    change = round(quote.get("change", 0.0), 2)
                    changes_pct = round(quote.get("changesPercentage", 0.0), 2)
                    st.metric("盤後最新報價", f"${price}", f"{change} ({changes_pct}%)")
                else:
                    st.warning("查無此檔盤後報價。(目前 Starter Plan 或該標的不支援盤後即時報價)")
                    
                st.markdown("---")
                st.markdown(f"### 📰 最近催化劑 (News Top 3)")
                if news_list and "Error Message" not in str(news_list):
                    for article in news_list:
                        pub_date = article.get('publishedDate', 'Unknown Date')
                        site = article.get('site', 'Unknown Resource')
                        title = article.get('title', 'No Title')
                        url = article.get('url', '#')
                        text = article.get('text', '')[:200] + "..."
                        
                        st.markdown(f"**[{title}]({url})**")
                        st.caption(f"發布時間: {pub_date} - 來源: {site}")
                        st.write(text)
                        st.markdown("---")
                else:
                    st.info("查無近期相關新聞。")

with tab5:
    st.subheader("🗂️ 歷次掃描與自選股保存庫")
    st.markdown("不管你在左邊怎麼重新送出新條件，這裡的紀錄**永遠不會被洗掉**。你可以透過方案 B 多次小範圍篩選，把每次的精華留存在這裡！")
    
    saved_history = st.session_state.get("saved_history", {})
    if not saved_history:
        st.info("目前還沒有儲存任何標的。請在「篩選結果」標籤頁中點擊【💾 儲存本次結果至無塵歷史庫存】！")
    else:
        history_keys = list(saved_history.keys())
        # 讓最新儲存的放在最上面
        history_keys.reverse()
        
        selected_hist = st.selectbox("📅 選擇要檢視的歷史掃描時間", history_keys)
        hist_df = saved_history[selected_hist]
        
        st.metric("該次保存檔數", f"{len(hist_df)} 檔股票")
        st.dataframe(hist_df, use_container_width=True)
        
        col_c, col_d = st.columns([1, 1])
        with col_c:
            if st.button("🗑️ 刪除此筆紀錄", key=f"del_{selected_hist}", use_container_width=True):
                del st.session_state["saved_history"][selected_hist]
                st.rerun()
        with col_d:
            if st.button("🧨 清空所有歷史紀錄", key="del_all", use_container_width=True):
                st.session_state["saved_history"] = {}
                st.rerun()
                
        st.markdown("---")
        st.markdown("### 🌟 所有歷史紀錄合併總覽 (Ultimate Watchlist)")
        all_df = pd.concat(saved_history.values(), ignore_index=True)
        # 以 Ticker 代碼進行去重，保留最新抓到的版本
        all_df = all_df.drop_duplicates(subset=["Ticker"], keep="first")
        
        st.metric("合併去重後總庫存", f"{len(all_df)} 檔股票")
        st.dataframe(all_df, use_container_width=True)
        
        csv_all = all_df.to_csv(index=False).encode('utf-8-sig')
        st.download_button("📥 匯出終極合併總表 (CSV)", csv_all, "ultimate_watchlist.csv", "text/csv")

with tab6:
    st.subheader("🧪 向量化回測實驗室 (Vectorized Backtester)")
    st.markdown("在這裡您可以自由切換並驗證不同的量化交易模型。")
    
    col_t1, col_t2 = st.columns(2)
    with col_t1:
        # 從歷史庫存中獲取所有 Ticker 作為選項
        hist_tickers = []
        saved_hist_dict = st.session_state.get("saved_history", {})
        for df_h in saved_hist_dict.values():
            if "Ticker" in df_h.columns:
                hist_tickers.extend(df_h["Ticker"].tolist())
        hist_tickers = list(set(hist_tickers))
        hist_tickers.sort()
        target_ticker = st.selectbox("1. 選擇左方掃描過或歷史庫存標的", [""] + available_tickers + hist_tickers)
        
    with col_t2:
        custom_ticker = st.text_input("2. 或自行手動輸入股票代碼 (優先套用)", value="")
        
    run_ticker = custom_ticker.upper().strip() if custom_ticker else target_ticker
    
    st.markdown("---")
    strategy_choice = st.radio("選擇回測策略模型", ["極端暴漲當沖放空 (Gap-Up Momentum Short)", "雙均線黃金交叉做多 (Dual SMA Crossover)"], horizontal=True)
    
    st.markdown("#### ⚙️ 策略參數")
    
    if "極端" in strategy_choice:
        st.info("💡 **無未來函數宣告**：純日線當沖。當 `T-1 與 T-2 日` 滿足暴漲條件時，於 `T日 開盤價` 模擬放空，並在 `T日 收盤價` 強制回補。")
        col_p1, col_p2 = st.columns(2)
        cond1_pct = col_p1.number_input("條件 1: 前日單日總漲幅大於 (%)", value=90.0, step=10.0)
        cond2_pct = col_p2.number_input("條件 2: 前日K棒實體 (開到收) 漲幅大於 (%)", value=70.0, step=10.0)
    else:
        st.info("💡 **無未來函數宣告**：波段做多策略。每日收盤結算均線，當 `快線向上突破慢線`，於 `隔日 (T+1)` 起始持有部位賺取每日漲跌報酬，死亡交叉則平倉。")
        col_p1, col_p2 = st.columns(2)
        sma_fast = col_p1.number_input("快線周期 (Fast SMA)", value=20, step=5, min_value=1)
        sma_slow = col_p2.number_input("慢線周期 (Slow SMA)", value=60, step=5, min_value=2)
    
    if run_ticker and st.button(f"▶️ 針對 {run_ticker} 執行策略回測", use_container_width=True):
        with st.spinner("擷取過去 5 年歷史數據並進行向量演算中..."):
            bt_data = get_historical_data(run_ticker, period="5y", provider_name=data_source, api_key=fmp_api_key)
            
            if bt_data is None or bt_data.empty:
                st.error("無法取得該標的之歷史連續資料。")
            else:
                bt_df = bt_data.copy()
                
                # ==== 策略分流計算 ====
                if "極端" in strategy_choice:
                    bt_df['Prev_Close'] = bt_df['Close'].shift(1)
                    bt_df['Prev_Prev_Close'] = bt_df['Close'].shift(2)
                    bt_df['Prev_Open'] = bt_df['Open'].shift(1)
                    
                    bt_df['Cond1_Val'] = (bt_df['Prev_Close'] / bt_df['Prev_Prev_Close'] - 1) * 100
                    bt_df['Cond2_Val'] = (bt_df['Prev_Close'] / bt_df['Prev_Open'] - 1) * 100
                    
                    bt_df['Signal'] = np.where(
                        (bt_df['Cond1_Val'] >= cond1_pct) & (bt_df['Cond2_Val'] >= cond2_pct), 
                        1, 0
                    )
                    bt_df['Daily_Trade_Return'] = np.where(bt_df['Signal'] == 1, (bt_df['Open'] - bt_df['Close']) / bt_df['Open'], 0)
                
                else:
                    # 雙均線計算
                    bt_df['Fast_SMA'] = bt_df['Close'].rolling(window=int(sma_fast)).mean()
                    bt_df['Slow_SMA'] = bt_df['Close'].rolling(window=int(sma_slow)).mean()
                    
                    # 訊號 1 = 持有部位, 0 = 空倉
                    bt_df['Signal'] = np.where(bt_df['Fast_SMA'] > bt_df['Slow_SMA'], 1, 0)
                    bt_df['Daily_Return'] = bt_df['Close'].pct_change()
                    
                    # 遞延 1 天享受報酬 (預防未來函數)
                    bt_df['Daily_Trade_Return'] = bt_df['Signal'].shift(1) * bt_df['Daily_Return']
                    bt_df['Daily_Trade_Return'] = bt_df['Daily_Trade_Return'].fillna(0)
                
                # ==== 績效結算 ====
                bt_df['Cumulative_Return'] = (1 + bt_df['Daily_Trade_Return']).cumprod() - 1
                bt_df['BnH_Return'] = bt_df['Close'].pct_change()
                bt_df['BnH_Cumulative'] = (1 + bt_df['BnH_Return']).cumprod() - 1
                
                total_trades = bt_df['Signal'].sum()
                
                if total_trades > 0:
                    win_trades = (bt_df['Daily_Trade_Return'] > 0).sum()
                    if "極端" in strategy_choice:
                        # 當沖是每一次 Signal 代表 1 次獨立 Trade
                        actual_trades = total_trades
                    else:
                        # 波段是持有的日子算入勝率較難單純算"次數"，這裡改算"持有天數中，賺錢的勝率"
                        actual_trades = total_trades 
                        
                    win_rate = (win_trades / actual_trades) * 100
                    total_ret = bt_df['Cumulative_Return'].iloc[-1] * 100
                    
                    running_max = (1 + bt_df['Cumulative_Return']).cummax()
                    drawdown = (1 + bt_df['Cumulative_Return']) / running_max - 1
                    mdd = drawdown.min() * 100
                    
                    active_returns = bt_df[bt_df['Daily_Trade_Return'] != 0]['Daily_Trade_Return']
                    sharpe = (active_returns.mean() / active_returns.std() * np.sqrt(252)) if len(active_returns) > 1 and active_returns.std() > 0 else 0
                    
                    if "極端" in strategy_choice:
                        st.success(f"回測完成！統計近五年內，共觸發此極端訊號 {int(actual_trades)} 次。")
                    else:
                        st.success(f"回測完成！統計近五年內，共有 {int(actual_trades)} 天處於持倉做多狀態。")
                        
                    c1, c2, c3, c4 = st.columns(4)
                    c1.metric("累積總報酬率 (無本金)", f"{total_ret:.2f}%")
                    c2.metric("最大資金回撤 (MDD)", f"{mdd:.2f}%")
                    c3.metric("勝率 (獲利日比率)", f"{win_rate:.1f}%", f"{int(win_trades)}/{int(actual_trades)} 日")
                    c4.metric("夏普比率 (年化)", f"{sharpe:.2f}")
                    
                    fig = go.Figure()
                    trace_name = '極端放空策略' if "極端" in strategy_choice else '均線做多策略'
                    trace_color = '#00ff00' if "極端" in strategy_choice else '#00BFFF'
                    
                    fig.add_trace(go.Scatter(x=bt_df.index, y=bt_df['Cumulative_Return']*100, mode='lines', name=trace_name, line=dict(color=trace_color, width=2)))
                    fig.add_trace(go.Scatter(x=bt_df.index, y=bt_df['BnH_Cumulative']*100, mode='lines', name='單純買入持有 (B&H)', line=dict(color='gray', dash='dot')))
                    fig.update_layout(title=f"資金成長對比 ({run_ticker})", hovermode="x unified", template="plotly_dark", yaxis_ticksuffix="%")
                    st.plotly_chart(fig, use_container_width=True)
                    
                    with st.expander("查看進出訊號明細 (Trade Logs)"):
                        if "極端" in strategy_choice:
                            details = bt_df[bt_df['Signal'] == 1][['Open', 'Close', 'Cond1_Val', 'Cond2_Val', 'Daily_Trade_Return']]
                            details.columns = ['開盤空點(出)', '收盤補點(進)', '前日單日總漲幅(%)', '前日K棒實體漲幅(%)', '當沖獲利(%)']
                            details['當沖獲利(%)'] = details['當沖獲利(%)'] * 100
                            st.dataframe(details.style.format(precision=2))
                        else:
                            bt_df['Position_Change'] = bt_df['Signal'].diff()
                            trade_events = bt_df[bt_df['Position_Change'] != 0].copy()
                            trade_events = trade_events.dropna(subset=['Position_Change'])
                            
                            details = trade_events[['Close', 'Fast_SMA', 'Slow_SMA', 'Position_Change']]
                            details['動作'] = np.where(details['Position_Change'] == 1, "↗️ 做多 (Buy)", "↘️ 空倉 (Sell)")
                            details = details.drop(columns=['Position_Change'])
                            details.columns = ['觸發價(當日Close)', f'快線({sma_fast})', f'慢線({sma_slow})', '明日起部位動作']
                            st.dataframe(details.style.format(precision=2))
                else:
                    if "極端" in strategy_choice:
                        st.warning(f"在此回測的 5 年期間內，沒有任何一天觸發這麼嚴苛的暴力漲幅條件！您可以試著將前日漲幅 ({cond1_pct}%) / 實體漲幅 ({cond2_pct}%) 的門檻調低看看。")
                    else:
                        st.warning("在此期間內條件從未滿足。請調整均線區間。")

with tab7:
    st.subheader("🤖 專業事件回測 (Backtrader Engine)")
    st.markdown("透過真實交易所模擬器 (`Backtrader`)，精確驗算含手續費、初始部位與時間推進下的絕對績效。此頁面運算邏輯已完全模組化分離，保障系統效能。")
    
    col_bt1, col_bt2 = st.columns([1, 1])
    with col_bt1:
        st.markdown("#### 1. 資料庫選擇")
        bt_source = st.radio("您要用什麼數據餵食給大腦引擎？", ["使用內建掃描庫存", "自行上傳外部自備 CSV (無數量限制)"], horizontal=True)
        
        target_df = None
        target_name = ""
        
        if "上傳" in bt_source:
            uploaded_file = st.file_uploader("📥 請上傳 OHLCV 歷史報價檔案 (.csv)", type=['csv'])
            if uploaded_file is not None:
                try:
                    target_df = pd.read_csv(uploaded_file)
                    target_name = uploaded_file.name
                    st.success(f"成功載入 CSV：共 {len(target_df)} 筆K線資料")
                except Exception as e:
                    st.error(f"解析 CSV 失敗: {e}")
        else:
            hist_tickers = []
            saved_hist_dict = st.session_state.get("saved_history", {})
            for df_h in saved_hist_dict.values():
                if "Ticker" in df_h.columns:
                    hist_tickers.extend(df_h["Ticker"].tolist())
            hist_tickers = list(set(hist_tickers))
            hist_tickers.sort()
            
            c_tick1, c_tick2 = st.columns(2)
            sel_tick = c_tick1.selectbox("選擇曾掃描過的標的", [""] + available_tickers + hist_tickers, key="bt_sel")
            man_tick = c_tick2.text_input("輸入欲即時下載的代碼", key="bt_man")
            final_tick = man_tick.upper().strip() if man_tick else sel_tick
            
            if final_tick:
                if final_tick in raw_data_dict:
                    target_df = raw_data_dict[final_tick].copy()
                else:
                    with st.spinner("從 API 下載連續報價中..."):
                        target_df = get_historical_data(final_tick, period="max", provider_name=data_source, api_key=fmp_api_key)
                target_name = final_tick
                if target_df is not None:
                    st.success(f"成功準備 {final_tick}，共 {len(target_df)} 筆K線")
                
    with col_bt2:
        st.markdown("#### 2. 券商環境設定")
        c_b1, c_b2 = st.columns(2)
        start_cash = c_b1.number_input("初始資金 ($USD)", value=100000, step=10000)
        
        comm_type = c_b2.radio("收費模式", ["百分比 (%)", "固定金額 ($)"], horizontal=True)
        if "百分比" in comm_type:
            commission_input = c_b2.number_input("單筆手續費率 (%)", value=0.1, step=0.01)
            commission_val = commission_input / 100.0
            is_fixed_comm = False
        else:
            commission_input = c_b2.number_input("單筆固定手續費 ($USD)", value=5.0, step=1.0)
            commission_val = commission_input
            is_fixed_comm = True
            
        st.markdown("#### 3. 策略與部位 (Strategy & Position)")
        bt_strategy_choice = st.selectbox("選擇核心大腦要搭載的策略邏輯", ["A. 雙均線波段做多 (含動態止盈止損)", "B. 極端暴漲當沖放空 (嚴格隔日收盤回補)"])
        
        c_p1, c_p2 = st.columns(2)
        stake = c_p1.number_input("每次進場股數 (Shares)", value=100, step=10, min_value=1)
        
        if "均線" in bt_strategy_choice:
            bt_fast = c_p1.number_input("快線 (SMA_Fast)", value=20, step=5)
            bt_slow = c_p2.number_input("慢線 (SMA_Slow)", value=60, step=5)
            c_sl1, c_sl2 = st.columns(2)
            tp_pct = c_sl1.number_input("止盈出局目標 (%) - 0為不設", value=15.0, step=1.0, min_value=0.0)
            sl_pct = c_sl2.number_input("止損出局限制 (%) - 0為不設", value=5.0, step=1.0, min_value=0.0)
            
            algo_params = {
                "strategy": "dual_sma",
                "sma_fast": bt_fast,
                "sma_slow": bt_slow,
                "stake": stake,
                "tp_pct": tp_pct,
                "sl_pct": sl_pct
            }
        else:
            cond1 = c_p1.number_input("前日單日總漲幅大於 (%)", value=90.0, step=10.0)
            cond2 = c_p2.number_input("前日開去收實體漲幅大於 (%)", value=70.0, step=10.0)
            
            c_sl1, c_sl2 = st.columns(2)
            tp_pct = c_sl1.number_input("做空止盈目標 (%) - 0為不設", value=15.0, step=1.0, min_value=0.0, key="b_tp")
            sl_pct = c_sl2.number_input("做空止損限制 (%) - 0為不設", value=5.0, step=1.0, min_value=0.0, key="b_sl")
            
            max_hold = st.number_input("最大持倉天數 (預設1天當沖)", value=1, step=1, min_value=1)
            
            algo_params = {
                "strategy": "momentum_short",
                "cond1_pct": cond1,
                "cond2_pct": cond2,
                "stake": stake,
                "tp_pct": tp_pct,
                "sl_pct": sl_pct,
                "max_hold": max_hold
            }
        
    st.markdown("---")
    
    if st.button("🚀 啟動 Backtrader 大腦引擎進行逐日撮合", use_container_width=True):
        if target_df is None or target_df.empty:
            st.error("啟動失敗：請先在上方提供有效的歷史報價資料庫！")
        else:
            with st.spinner("大腦引擎模擬逐日推進、計算保證金與撮合交易中... (可能耗時數秒)"):
                try:
                    from backtrader_engine import run_backtrader
                    params_dict = {
                        "starting_cash": start_cash,
                        "commission_val": commission_val,
                        "is_fixed_comm": is_fixed_comm,
                        **algo_params
                    }
                    metrics, equity_df = run_backtrader(target_df, params_dict)
                    
                    st.success(f"✅ 回測完畢！總計完成 {metrics['total_trades']} 趟完整交易 (買+賣)。")
                    
                    m1, m2, m3, m4, m5 = st.columns(5)
                    m1.metric("初始資金", f"${start_cash:,.2f}")
                    m2.metric("期末淨值", f"${metrics['final_value']:,.2f}", f"{metrics['total_return_pct']:.2f}%")
                    m3.metric("最大資金回撤 (MDD)", f"{metrics['mdd_pct']:.2f}%")
                    m4.metric("交易趟數 (含勝率)", f"{metrics['total_trades']} 趟", f"{metrics['win_rate']:.1f}% 勝")
                    m5.metric("夏普比率", f"{metrics['sharpe']:.2f}")
                    
                    fig_bt = go.Figure()
                    fig_bt.add_trace(go.Scatter(x=equity_df.index, y=equity_df['Cumulative_Return']*100, mode='lines', name='大腦引擎結算報酬 (%)', fill='tozeroy', line=dict(color='#ff9900')))
                    fig_bt.update_layout(title=f"真實資金成長曲線 ({target_name})", hovermode="x unified", template="plotly_dark", yaxis_ticksuffix="%")
                    st.plotly_chart(fig_bt, use_container_width=True)
                    
                except ValueError as ve:
                    st.error(f"資料格式錯誤: {str(ve)}")
                except Exception as e:
                    st.error(f"大腦引擎執行時發生預期外的錯誤: {str(e)}")
