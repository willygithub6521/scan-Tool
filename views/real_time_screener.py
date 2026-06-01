import streamlit as st
import pandas as pd
from streamlit_autorefresh import st_autorefresh
import time
from data_fetcher import get_realtime_biggest_gainers, get_realtime_quotes, get_floats

def render_page():
    st.title("⚡ Real-time Screener (Top Gainers)")
    
    # 1. API Key Check
    fmp_api_key = ""
    try:
        fmp_api_key = st.secrets.get("FMP_API_KEY", "")
    except Exception:
        pass
        
    if not fmp_api_key:
        st.warning("請先在 Historical Scanner 頁面或 secrets.toml 中設定 FMP API Key。")
        return

    # 2. Sidebar Filters
    st.sidebar.markdown("---")
    st.sidebar.header("Real-time Screener 篩選")
    
    # Auto-refresh setup
    col_ref1, col_ref2 = st.sidebar.columns([2, 1])
    auto_refresh_mins = col_ref1.number_input("自動更新頻率 (分鐘)", value=5, min_value=1, step=1)
    
    if "rts_refresh_count" not in st.session_state:
        st.session_state["rts_refresh_count"] = 0

    if col_ref2.button("🔄 手動更新"):
        st.session_state["rts_refresh_count"] += 1
        st.rerun()

    # Apply autorefresh (uses the refresh count as key so it resets on manual refresh)
    st_autorefresh(interval=auto_refresh_mins * 60 * 1000, key=f"rts_autorefresh_{st.session_state['rts_refresh_count']}")

    st.sidebar.markdown("---")
    st.sidebar.subheader("數值篩選條件")
    min_gap = st.sidebar.number_input("Gap 跳空大於 (%)", value=0.0, step=1.0)
    min_gainer = st.sidebar.number_input("Gainer 漲幅大於 (%)", value=5.0, step=1.0)
    min_intraday = st.sidebar.number_input("開盤到目前漲幅大於 (%)", value=0.0, step=1.0)
    
    col_mc1, col_mc2 = st.sidebar.columns(2)
    min_mc_m = col_mc1.number_input("最低市值 (M)", value=0.0, step=10.0)
    max_mc_m = col_mc2.number_input("最高市值 (M)", value=5000.0, step=100.0)
    
    col_fl1, col_fl2 = st.sidebar.columns(2)
    min_float_m = col_fl1.number_input("最低 Float (M)", value=0.0, step=1.0)
    max_float_m = col_fl2.number_input("最高 Float (M)", value=500.0, step=10.0)
    
    st.sidebar.markdown("---")
    strict_filter = st.sidebar.checkbox("僅顯示達標標的 (過濾未達標)", value=True)

    # 3. Fetch Data
    st.write(f"上次更新時間: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')} (每 {auto_refresh_mins} 分鐘自動更新)")
    
    with st.spinner("正在獲取最新 Top Gainers 資料..."):
        gainers_data = get_realtime_biggest_gainers(fmp_api_key)
        
    if not gainers_data:
        st.error("無法獲取 Top Gainers 資料，請確認 API Key 額度或稍後再試。")
        return
        
    # extract tickers (FMP biggest-gainers returns list of dicts with 'symbol')
    tickers = [item['symbol'] for item in gainers_data if 'symbol' in item]
    
    if not tickers:
        st.info("目前無 Top Gainers 資料。")
        return
        
    with st.spinner(f"正在獲取 {len(tickers)} 檔股票的即時報價與 Float..."):
        quotes_data = get_realtime_quotes(fmp_api_key, tickers)
        floats_dict = get_floats(fmp_api_key, tickers)
        
    # 4. Process and Filter
    results = []
    
    # Create lookup dictionary for quotes
    quotes_dict = {q['symbol']: q for q in quotes_data if 'symbol' in q}
    
    for ticker in tickers:
        quote = quotes_dict.get(ticker, {})
        
        price = quote.get('price', 0)
        open_price = quote.get('open', 0)
        prev_close = quote.get('previousClose', 0)
        changes_pct = quote.get('changesPercentage', 0)
        market_cap = quote.get('marketCap', 0)
        
        # Calculate metrics
        gap_pct = ((open_price / prev_close - 1) * 100) if prev_close and prev_close > 0 else 0
        intraday_pct = ((price / open_price - 1) * 100) if open_price and open_price > 0 else 0
        mc_m = market_cap / 1e6 if market_cap else 0
        
        float_shares = floats_dict.get(ticker, 0)
        float_m = float_shares / 1e6 if float_shares else 0
        
        # Check conditions
        cond_gap = gap_pct >= min_gap
        cond_gainer = changes_pct >= min_gainer
        cond_intraday = intraday_pct >= min_intraday
        
        # Market Cap bounds
        cond_mc = True
        if min_mc_m > 0: cond_mc = cond_mc and (mc_m >= min_mc_m)
        if max_mc_m > 0: cond_mc = cond_mc and (mc_m <= max_mc_m)
        
        # Float bounds
        cond_float = True
        if min_float_m > 0: cond_float = cond_float and (float_m >= min_float_m)
        if max_float_m > 0: cond_float = cond_float and (float_m <= max_float_m)
        
        is_passed = cond_gap and cond_gainer and cond_intraday and cond_mc and cond_float
        
        results.append({
            "Ticker": ticker,
            "Price": round(price, 2),
            "Gap (%)": round(gap_pct, 2),
            "Gainer (%)": round(changes_pct, 2),
            "開盤到目前漲幅 (%)": round(intraday_pct, 2),
            "Market Cap (M)": round(mc_m, 2) if mc_m > 0 else "N/A",
            "Float (M)": round(float_m, 2) if float_m > 0 else "N/A",
            "達標 Signal": "✅" if is_passed else "❌",
            "_is_passed": is_passed
        })
        
    df_results = pd.DataFrame(results)
    
    if strict_filter and not df_results.empty:
        df_results = df_results[df_results["_is_passed"]]
        
    if not df_results.empty:
        df_results = df_results.drop(columns=["_is_passed"])
        # styling for positive/negative returns
        def color_returns(val):
            if isinstance(val, (int, float)):
                color = 'green' if val > 0 else 'red' if val < 0 else 'white'
                return f'color: {color}'
            return ''
            
        styled_df = df_results.style.map(color_returns, subset=["Gap (%)", "Gainer (%)", "開盤到目前漲幅 (%)"])
        st.dataframe(styled_df, use_container_width=True, hide_index=True)
    else:
        st.warning("目前沒有任何股票符合您的即時篩選條件。")

if __name__ == "__main__":
    render_page()
