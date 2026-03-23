import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from data_fetcher import get_historical_data, get_basic_info, get_fmp_screener_tickers
from indicators import add_sma, add_ema, add_rsi, add_macd, add_bollinger_bands, add_atr
import io

st.set_page_config(page_title="Stock Scanner Tool PRO", layout="wide")

st.title("📈 Stock Scanner Tool (Phase 3 + Screener API)")

# --- Sidebar ---
st.sidebar.header("配置與輸入")

# 資料來源選擇
data_source = st.sidebar.selectbox("資料來源", ["Yahoo Finance", "FMP"])
fmp_api_key = ""
if data_source == "FMP":
    fmp_api_key = st.sidebar.text_input("FMP API Key", type="password", help="請輸入 Financial Modeling Prep 提供的 API Key")
    if not fmp_api_key:
        try:
            fmp_api_key = st.secrets.get("FMP_API_KEY", "")
        except Exception:
            pass
            
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
    mkt_cap_min = st.sidebar.number_input("最低市值 (十億 USD)", value=50, min_value=0)
    price_more_than = st.sidebar.number_input("股價大於 ($)", value=20, min_value=0)
    sector = st.sidebar.selectbox("產業分類 (可選)", ["", "Technology", "Healthcare", "Financial Services", "Energy", "Consumer Cyclical"])
    limit = st.sidebar.slider("最大返回數量", 10, 200, 30)
    st.sidebar.markdown("---")
    
    if fmp_api_key:
        params = {
            "marketCapMoreThan": int(mkt_cap_min * 1e9),
            "priceMoreThan": price_more_than,
            "sector": sector,
            "limit": limit
        }
        with st.sidebar:
            with st.spinner("📡 正在向 FMP 請求符合條件的標的..."):
                tickers = get_fmp_screener_tickers(fmp_api_key, params)
        if tickers:
            st.sidebar.success(f"成功透過 API 取得 {len(tickers)} 檔股票！")
        else:
            st.sidebar.warning("API 篩選找不到任何股票或發生錯誤。")
    else:
        st.sidebar.warning("請先於上方輸入 FMP API Key。")


period = st.sidebar.selectbox("資料期間", ["1mo", "3mo", "6mo", "1y", "2y", "5y", "max"], index=3)

st.sidebar.subheader("第二階段：技術面篩選條件 (Client-Side)")
sma_window = st.sidebar.number_input("SMA 天數", value=50, step=5)
rsi_limit = st.sidebar.number_input("RSI 上限 (找超賣)", value=30, step=5)
bb_window = st.sidebar.number_input("布林通道天數", value=20, step=1)

# --- Main App ---
if not tickers:
    st.info("👈 請在左側輸入代碼或進行條件篩選以開始。")
    st.stop()
    
if data_source == "FMP" and not fmp_api_key:
    st.error("您選擇了 FMP 作為資料來源，但尚未提供 API Key。請在左側欄輸入。")
    st.stop()

st.write(f"**準備進行技術分析掃描清單 ({len(tickers)} 檔)**: " + ", ".join(tickers[:15]) + ("..." if len(tickers)>15 else ""))

progress_text = f"正在透過 {data_source} 擷取歷史報價與運算技術指標..."
my_bar = st.progress(0, text=progress_text)

results = []
raw_data_dict = {}

for i, ticker in enumerate(tickers):
    my_bar.progress((i + 1) / len(tickers), text=f"處理中: {ticker} ({i+1}/{len(tickers)})")
    
    df = get_historical_data(ticker, data_source, period, fmp_api_key)
    if df.empty:
        continue
    
    df = add_sma(df, window=sma_window)
    df = add_rsi(df, window=14)
    df = add_macd(df)
    df = add_bollinger_bands(df, window=bb_window)
    df = add_atr(df, window=14)
    
    raw_data_dict[ticker] = df
    latest_data = df.iloc[-1]
    
    info = get_basic_info(ticker, data_source, fmp_api_key)
    company_name = info.get('shortName', ticker)
    sector_info = info.get('sector', 'N/A')
    
    cond_price_sma = latest_data['Close'] > latest_data[f'SMA_{sma_window}']
    cond_rsi = latest_data['RSI_14'] < rsi_limit
    cond_bb_lower = latest_data['Close'] < latest_data[f'BB_Lower_{bb_window}']
    
    results.append({
        "Ticker": ticker,
        "Name": company_name,
        "Sector": sector_info,
        "Close": round(latest_data['Close'], 2),
        f"SMA_{sma_window}": round(latest_data[f'SMA_{sma_window}'], 2),
        "RSI_14": round(latest_data['RSI_14'], 2),
        f"BB_Lower_{bb_window}": round(latest_data[f'BB_Lower_{bb_window}'], 2),
        "ATR_14": round(latest_data['ATR_14'], 2),
        "Price > SMA": "✅" if cond_price_sma else "❌",
        "RSI < Limit": "✅" if cond_rsi else "❌",
        "Price < BB Lower": "✅" if cond_bb_lower else "❌"
    })

my_bar.empty()

if not results:
    st.warning("所有股票都查無歷史資料，無法分析。")
    st.stop()

results_df = pd.DataFrame(results)

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
        selected_ticker = st.selectbox("選擇股票代碼", [r['Ticker'] for r in results])
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
    raw_ticker = st.selectbox("選擇要檢視歷史列的股票", [r['Ticker'] for r in results], key="raw_select")
    raw_df = raw_data_dict[raw_ticker]
    st.dataframe(raw_df.tail(100).sort_index(ascending=False), use_container_width=True)
