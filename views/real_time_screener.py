from pandas.io.formats import console
import streamlit as st
import pandas as pd
from streamlit_autorefresh import st_autorefresh
import time
import threading
from data_fetcher import get_realtime_biggest_gainers, get_realtime_quotes, get_floats, get_realtime_5min_closes

# --- Global State for Background Thread ---
@st.cache_resource
def get_global_rts_state():
    return {
        "api_key": "",
        "next_refresh_time": 0,
        "data": {
            "gainers": None,
            "quotes": None,
            "floats": None,
            "closes_5min": None,
            "fetch_time": None
        },
        "is_fetching": False,
        "has_prefetched": False,
        "thread": None
    }

RTS_STATE = get_global_rts_state()

def start_background_thread(state):
    def bg_fetch_loop(state_dict):
        while True:
            try:
                now = time.time()
                # Check if we should pre-fetch (30 seconds before next refresh)
                if state_dict["api_key"] and state_dict["next_refresh_time"] > 0:
                    time_to_refresh = state_dict["next_refresh_time"] - now
                    
                    # Reset the prefetch flag if we are outside the 30s window
                    if time_to_refresh > 30:
                        state_dict["has_prefetched"] = False

                    # If within 30 seconds of refresh and not already fetching
                    if 0 < time_to_refresh <= 30 and not state_dict["is_fetching"] and not state_dict["has_prefetched"]:
                        state_dict["is_fetching"] = True
                        try:
                            api_key = state_dict["api_key"]
                            gainers = get_realtime_biggest_gainers(api_key)
                            
                            if gainers:
                                tickers = [item['symbol'] for item in gainers if 'symbol' in item]
                                quotes = get_realtime_quotes(api_key, tickers) if tickers else []
                                floats = get_floats(api_key, tickers) if tickers else {}
                                closes_5min = get_realtime_5min_closes(api_key, tickers) if tickers else {}
                                
                                state_dict["data"] = {
                                    "gainers": gainers,
                                    "quotes": quotes,
                                    "floats": floats,
                                    "closes_5min": closes_5min,
                                    "fetch_time": pd.Timestamp.now()
                                }
                        except Exception as e:
                            print(f"Background fetch error: {e}")
                        finally:
                            state_dict["is_fetching"] = False
                            state_dict["has_prefetched"] = True # Mark as prefetched regardless of success to prevent hammering
            except Exception as e:
                print(f"Thread loop critical error: {e}")
            time.sleep(1)

    # Only start if thread is not alive
    if state["thread"] is None or not state["thread"].is_alive():
        t = threading.Thread(target=bg_fetch_loop, args=(state,), daemon=True)
        t.start()
        state["thread"] = t

# Ensure the thread is alive on every script rerun
start_background_thread(RTS_STATE)

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

    RTS_STATE["api_key"] = fmp_api_key

    # 2. Sidebar Filters
    st.sidebar.markdown("---")
    st.sidebar.header("Real-time Screener 篩選")
    
    # Auto-refresh setup
    col_ref1, col_ref2 = st.sidebar.columns([2, 1])
    auto_refresh_mins = col_ref1.number_input("自動更新頻率 (分鐘)", value=5, min_value=1, step=1)
    
    if "rts_refresh_count" not in st.session_state:
        st.session_state["rts_refresh_count"] = 0
        st.session_state["prev_auto_refresh_mins"] = auto_refresh_mins

    # Detect interval change to properly restart timer
    if st.session_state.get("prev_auto_refresh_mins", auto_refresh_mins) != auto_refresh_mins:
        st.session_state["prev_auto_refresh_mins"] = auto_refresh_mins
        st.session_state["rts_refresh_count"] += 1
        st.session_state["last_autorefresh_count"] = -1
        RTS_STATE["next_refresh_time"] = time.time() + auto_refresh_mins * 60
        st.rerun()

    if col_ref2.button("🔄 手動更新"):
        # Force a new fetch
        with st.spinner("正在獲取最新 Top Gainers 資料..."):
            gainers = get_realtime_biggest_gainers(fmp_api_key)
            # print(f'Gainers: {gainers}')
            
        if gainers:
            tickers = [item['symbol'] for item in gainers if 'symbol' in item]
            with st.spinner(f"正在獲取 {len(tickers)} 檔股票的即時報價與 Float..."):
                quotes = get_realtime_quotes(fmp_api_key, tickers) if tickers else []
                floats = get_floats(fmp_api_key, tickers) if tickers else {}
                closes_5min = get_realtime_5min_closes(fmp_api_key, tickers) if tickers else {}
                RTS_STATE["data"] = {
                    "gainers": gainers,
                    "quotes": quotes,
                    "floats": floats,
                    "closes_5min": closes_5min,
                    "fetch_time": pd.Timestamp.now()
                }
        else:
            st.toast("未能取得最新資料，可能已達 API 上限。已為您保留最新一筆記錄。", icon="⚠️")
            
        st.session_state["rts_refresh_count"] += 1
        st.session_state["last_autorefresh_count"] = -1 # Reset so next autorefresh triggers update
        RTS_STATE["next_refresh_time"] = time.time() + auto_refresh_mins * 60
        st.rerun()

    # Apply autorefresh (uses the refresh count as key so it resets on manual refresh)
    refresh_count = st_autorefresh(interval=auto_refresh_mins * 60 * 1000, key=f"rts_autorefresh_{st.session_state['rts_refresh_count']}")
    
    if "last_autorefresh_count" not in st.session_state:
        st.session_state["last_autorefresh_count"] = refresh_count
        RTS_STATE["next_refresh_time"] = time.time() + auto_refresh_mins * 60

    # Only update the next refresh time if the autorefresh actually ticked
    if refresh_count != st.session_state["last_autorefresh_count"]:
        st.session_state["last_autorefresh_count"] = refresh_count
        RTS_STATE["next_refresh_time"] = time.time() + auto_refresh_mins * 60

    st.sidebar.markdown("---")
    st.sidebar.subheader("數值篩選條件")
    min_gap = st.sidebar.number_input("Gap 跳空大於 (%)", value=0.0, step=1.0)
    min_gainer = st.sidebar.number_input("Gainer 漲幅大於 (%)", value=5.0, step=1.0)
    min_intraday = st.sidebar.number_input("開盤到目前漲幅大於 (%)", value=0.0, step=1.0)
    min_5min_pct = st.sidebar.number_input("最近5分鐘漲幅大於 (%)", value=0.0, step=1.0)
    
    col_mc1, col_mc2 = st.sidebar.columns(2)
    min_mc_m = col_mc1.number_input("最低市值 (M)", value=0.0, step=10.0)
    max_mc_m = col_mc2.number_input("最高市值 (M)", value=5000.0, step=100.0)
    
    col_fl1, col_fl2 = st.sidebar.columns(2)
    min_float_m = col_fl1.number_input("最低 Float (M)", value=0.0, step=1.0)
    max_float_m = col_fl2.number_input("最高 Float (M)", value=500.0, step=10.0)
    
    st.sidebar.markdown("---")
    strict_filter = st.sidebar.checkbox("僅顯示達標標的 (過濾未達標)", value=True)

    # 3. Data Loading (From Cache or Initial Fetch)
    data_cache = RTS_STATE["data"]
    
    if data_cache["gainers"] is None:
        with st.spinner("初次載入，正在獲取最新 Top Gainers 資料..."):
            gainers = get_realtime_biggest_gainers(fmp_api_key)
            if gainers:
                tickers = [item['symbol'] for item in gainers if 'symbol' in item]
                with st.spinner(f"正在獲取 {len(tickers)} 檔股票的即時報價與 Float..."):
                    quotes = get_realtime_quotes(fmp_api_key, tickers)
                    floats = get_floats(fmp_api_key, tickers)
                    closes_5min = get_realtime_5min_closes(fmp_api_key, tickers)
                    
                    data_cache = {
                        "gainers": gainers,
                        "quotes": quotes,
                        "floats": floats,
                        "closes_5min": closes_5min,
                        "fetch_time": pd.Timestamp.now()
                    }
                    RTS_STATE["data"] = data_cache

    if data_cache["gainers"] is None:
        st.error("無法獲取 Top Gainers 資料，請確認 API Key 額度或稍後再試。")
        return
        
    fetch_time = data_cache["fetch_time"]
    time_str = fetch_time.strftime('%Y-%m-%d %H:%M:%S') if fetch_time else "未知"
    st.write(f"資料更新時間: {time_str} (每 {auto_refresh_mins} 分鐘自動更新，修改篩選條件將即時套用不重抓)")
    
    gainers_data = data_cache["gainers"]
    tickers = [item['symbol'] for item in gainers_data if 'symbol' in item]
    
    if not tickers:
        st.info("目前無 Top Gainers 資料。")
        return

    quotes_data = data_cache["quotes"]
    floats_dict = data_cache["floats"]
    closes_5min_dict = data_cache["closes_5min"]
    
    # 4. Process and Filter (Instantaneous, using cached data)
    results = []
    quotes_dict = {q['symbol']: q for q in quotes_data if 'symbol' in q}
    
    for ticker in tickers:
        quote = quotes_dict.get(ticker, {})
        
        price = quote.get('price', 0)
        open_price = quote.get('open', 0)
        prev_close = quote.get('previousClose', 0)
        changes_pct = quote.get('changePercentage', 0)
        market_cap = quote.get('marketCap', 0)
        
        # Calculate metrics
        gap_pct = ((open_price / prev_close - 1) * 100) if prev_close and prev_close > 0 else 0
        intraday_pct = ((price / open_price - 1) * 100) if open_price and open_price > 0 else 0
        mc_m = market_cap / 1e6 if market_cap else 0
        
        float_shares = floats_dict.get(ticker, 0)
        float_m = float_shares / 1e6 if float_shares else 0
        
        prev_5min_close = closes_5min_dict.get(ticker, 0)
        recent_5min_pct = ((price / prev_5min_close - 1) * 100) if prev_5min_close and prev_5min_close > 0 else 0
        
        # Check conditions
        cond_gap = gap_pct >= min_gap
        cond_gainer = changes_pct >= min_gainer
        cond_intraday = intraday_pct >= min_intraday
        cond_5min = recent_5min_pct >= min_5min_pct
        
        # Market Cap bounds
        cond_mc = True
        if min_mc_m > 0: cond_mc = cond_mc and (mc_m >= min_mc_m)
        if max_mc_m > 0: cond_mc = cond_mc and (mc_m <= max_mc_m)
        
        # Float bounds
        cond_float = True
        if min_float_m > 0: cond_float = cond_float and (float_m >= min_float_m)
        if max_float_m > 0: cond_float = cond_float and (float_m <= max_float_m)
        
        is_passed = cond_gap and cond_gainer and cond_intraday and cond_5min and cond_mc and cond_float
        
        results.append({
            "Ticker": ticker,
            "Price": round(price, 2),
            "Gap (%)": round(gap_pct, 2),
            "Gainer (%)": round(changes_pct, 2),
            "開盤到目前漲幅 (%)": round(intraday_pct, 2),
            "最近5分鐘漲幅 (%)": round(recent_5min_pct, 2) if prev_5min_close > 0 else 0.0,
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
        def color_returns(val):
            if isinstance(val, (int, float)):
                color = 'green' if val > 0 else 'red' if val < 0 else 'white'
                return f'color: {color}'
            return ''
            
        styled_df = df_results.style.map(color_returns, subset=["Gap (%)", "Gainer (%)", "開盤到目前漲幅 (%)", "最近5分鐘漲幅 (%)"])
        st.dataframe(styled_df, use_container_width=True, hide_index=True)
    else:
        st.warning("目前沒有任何股票符合您的即時篩選條件。")

if __name__ == "__main__":
    render_page()

