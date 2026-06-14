import streamlit as st
import pandas as pd
from streamlit_autorefresh import st_autorefresh
import time
import threading
from data_fetcher import (
    get_realtime_biggest_gainers,
    get_realtime_quotes,
    get_floats,
    get_realtime_5min_closes,
    get_realtime_1min_closes
)

# --- Global Helper for Market Session ---
def get_market_session():
    """判定當前美東時間交易時段"""
    try:
        now_est = pd.Timestamp.now('US/Eastern')
        if now_est.weekday() >= 5:
            return "closed"
        time_int = now_est.hour * 100 + now_est.minute
        if 400 <= time_int < 930:
            return "extended"
        elif 930 <= time_int < 1600:
            return "regular"
        elif 1600 <= time_int < 2000:
            return "extended"
        else:
            return "closed"
    except Exception as e:
        print(f"[ERROR] get_market_session failed: {e}", flush=True)
        return "closed"

def get_closes_with_cache(api_key, tickers, resolved_interval, from_date, extended, cache_dict):
    """常規交易時段使用：取得K線並使用本地快取以免頻繁請求"""
    now_est = pd.Timestamp.now('US/Eastern')
    valid_closes = {}
    tickers_to_fetch = []
    
    interval_cache = cache_dict.setdefault(resolved_interval, {})
    
    for ticker in tickers:
        cached = interval_cache.get(ticker)
        if cached:
            # 檢查快取是否過期 (跨越分鐘/5分鐘邊界)
            cached_time = cached["timestamp"]
            if resolved_interval == "1min":
                expired = (cached_time.day != now_est.day) or (cached_time.hour != now_est.hour) or (cached_time.minute != now_est.minute)
            else:
                expired = (cached_time.day != now_est.day) or (cached_time.hour != now_est.hour) or (cached_time.minute // 5 != now_est.minute // 5)
            
            if not expired and cached["closes"]:
                valid_closes[ticker] = cached["closes"]
                continue
                
        tickers_to_fetch.append(ticker)
        
    if tickers_to_fetch:
        try:
            if resolved_interval == "1min":
                fetched = get_realtime_1min_closes(api_key, tickers_to_fetch, from_date=from_date, extended=extended)
            else:
                fetched = get_realtime_5min_closes(api_key, tickers_to_fetch, from_date=from_date, extended=extended)
                
            for ticker, closes in fetched.items():
                if closes:
                    valid_closes[ticker] = closes
                    interval_cache[ticker] = {
                        "closes": closes,
                        "timestamp": now_est
                    }
        except Exception as e:
            print(f"[ERROR] get_closes_with_cache fetch failed: {e}", flush=True)
            
    # For tickers that failed to fetch and don't have valid closes, we fallback to expired cache if available
    for ticker in tickers:
        if ticker not in valid_closes:
            cached = interval_cache.get(ticker)
            if cached and cached["closes"]:
                valid_closes[ticker] = cached["closes"]
            else:
                valid_closes[ticker] = []
                
    return valid_closes

# --- Global State for Background Thread & Watchlist ---
@st.cache_resource
def get_global_rts_state():
    return {
        "api_key": "",
        "next_refresh_time": 0,
        "data": {
            "gainers": None,
            "quotes": None,
            "floats": {},
            "closes_5min": None,
            "closes_1min": None,
            "resolved_interval": "5min",
            "fetch_time": None
        },
        "watchlist": {},  # Persistently tracks triggered pullback stocks
        "historical_closes_cache": {
            "1min": {},  # format: { ticker: { "closes": [...], "timestamp": pd.Timestamp } }
            "5min": {}   # format: { ticker: { "closes": [...], "timestamp": pd.Timestamp } }
        },
        "is_fetching": False,
        "has_prefetched": False,
        "thread": None,
        "settings": {
            "interval": "Auto (根據更新頻率)",
            "today_only": True,
            "extended": True,
            "auto_refresh_mins": 5,
            "watchlist_expiry_mins": 15
        }
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
                                
                                # 1. Optimize float fetching: only fetch floats for missing tickers
                                existing_floats = state_dict["data"].get("floats") or {}
                                missing_tickers = [t for t in tickers if t not in existing_floats]
                                if missing_tickers:
                                    new_floats = get_floats(api_key, missing_tickers)
                                    existing_floats.update(new_floats)
                                    # Mark missing ones that weren't found as 0 to prevent repeating queries
                                    for t in missing_tickers:
                                        if t not in existing_floats:
                                            existing_floats[t] = 0
                                
                                # 2. Determine settings
                                settings = state_dict.get("settings", {
                                    "interval": "Auto (根據更新頻率)",
                                    "today_only": True,
                                    "extended": True,
                                    "auto_refresh_mins": 5
                                })
                                
                                # Resolve actual interval
                                resolved_interval = "5min"
                                interval_setting = settings.get("interval", "Auto (根據更新頻率)")
                                if "Auto" in interval_setting:
                                    ref_mins = settings.get("auto_refresh_mins", 5)
                                    resolved_interval = "1min" if ref_mins < 5 else "5min"
                                elif "1min" in interval_setting:
                                    resolved_interval = "1min"
                                else:
                                    resolved_interval = "5min"
                                    
                                # Resolve from_date
                                from_date = ""
                                if settings.get("today_only", True):
                                    from_date = pd.Timestamp.now('US/Eastern').strftime('%Y-%m-%d')
                                    
                                extended = settings.get("extended", True)
                                
                                # 3. Fetch closes list (returns last 10 closes)
                                session = get_market_session()
                                if session == "regular":
                                    closes_data = get_closes_with_cache(
                                        api_key, tickers, resolved_interval, 
                                        from_date, extended, state_dict["historical_closes_cache"]
                                    )
                                else:
                                    if resolved_interval == "1min":
                                        closes_data = get_realtime_1min_closes(api_key, tickers, from_date=from_date, extended=extended)
                                    else:
                                        closes_data = get_realtime_5min_closes(api_key, tickers, from_date=from_date, extended=extended)
                                
                                state_dict["data"] = {
                                    "gainers": gainers,
                                    "quotes": quotes,
                                    "floats": existing_floats,
                                    "closes_5min": closes_data if resolved_interval == "5min" else None,
                                    "closes_1min": closes_data if resolved_interval == "1min" else None,
                                    "resolved_interval": resolved_interval,
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
    col_title, col_status = st.columns([4, 1])
    col_title.title("⚡ Real-time Screener (Top Gainers)")
    
    session = get_market_session()
    if session == "regular":
        status_html = '<div style="text-align: right; margin-top: 25px;"><span style="background-color: #2e7d32; color: white; padding: 6px 12px; border-radius: 15px; font-weight: bold; font-size: 14px; border: 1px solid #4caf50; display: inline-block;">🟢 Regular</span></div>'
    elif session == "extended":
        status_html = '<div style="text-align: right; margin-top: 25px;"><span style="background-color: #ef6c00; color: white; padding: 6px 12px; border-radius: 15px; font-weight: bold; font-size: 14px; border: 1px solid #ff9800; display: inline-block;">🟠 Extended</span></div>'
    else:
        status_html = '<div style="text-align: right; margin-top: 25px;"><span style="background-color: #37474f; color: white; padding: 6px 12px; border-radius: 15px; font-weight: bold; font-size: 14px; border: 1px solid #78909c; display: inline-block;">⚪ Closed</span></div>'
        
    col_status.markdown(status_html, unsafe_allow_html=True)
    
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
    auto_refresh_mins = col_ref1.number_input("自動更新頻率 (分鐘)", value=5, min_value=1, step=1, key="auto_refresh_mins")
    
    if "rts_refresh_count" not in st.session_state:
        st.session_state["rts_refresh_count"] = 0
        st.session_state["prev_auto_refresh_mins"] = auto_refresh_mins

    # Advanced FMP Settings expander (Integrated settings panel)
    with st.sidebar.expander("⚙️ FMP 進階設定 (Premium)", expanded=True):
        intraday_interval = st.selectbox(
            "收盤價分鐘級距",
            options=["Auto (根據更新頻率)", "1min", "5min"],
            index=0,
            key="intraday_interval"
        )
        today_only = st.checkbox("僅限今日數據 (減小傳輸)", value=True, key="today_only")
        extended_hours = st.checkbox("包含盤前/盤後數據 (Extended)", value=True, key="extended_hours")
        watchlist_expiry_mins = st.number_input("觀察池保留時間 (分鐘)", value=15, min_value=1, max_value=120, step=1, key="watchlist_expiry_mins")

    # Sync settings into the global RTS_STATE so background thread can access them
    RTS_STATE["settings"] = {
        "interval": intraday_interval,
        "today_only": today_only,
        "extended": extended_hours,
        "auto_refresh_mins": auto_refresh_mins,
        "watchlist_expiry_mins": watchlist_expiry_mins
    }

    # Resolve actual interval for UI and instant fetching
    resolved_interval_ui = "5min"
    if "Auto" in intraday_interval:
        resolved_interval_ui = "1min" if auto_refresh_mins < 5 else "5min"
    elif "1min" in intraday_interval:
        resolved_interval_ui = "1min"
    else:
        resolved_interval_ui = "5min"

    # Compute actual window minutes for UI labels
    if resolved_interval_ui == "1min":
        actual_window_mins_ui = min(auto_refresh_mins, 10)
    else:
        actual_window_mins_ui = min(max(1, auto_refresh_mins // 5), 10) * 5

    # Detect interval change to properly restart timer
    if st.session_state.get("prev_auto_refresh_mins", auto_refresh_mins) != auto_refresh_mins:
        st.session_state["prev_auto_refresh_mins"] = auto_refresh_mins
        st.session_state["rts_refresh_count"] += 1
        st.session_state["last_autorefresh_count"] = -1
        RTS_STATE["next_refresh_time"] = time.time() + auto_refresh_mins * 60

    if col_ref2.button("🔄 手動更新"):
        # Force a new fetch
        with st.spinner("正在獲取最新 Top Gainers 資料..."):
            gainers = get_realtime_biggest_gainers(fmp_api_key)
            
        if gainers:
            tickers = [item['symbol'] for item in gainers if 'symbol' in item]
            with st.spinner(f"正在獲取 {len(tickers)} 檔股票的即時報價與 Float..."):
                quotes = get_realtime_quotes(fmp_api_key, tickers) if tickers else []
                
                # Optimize floats: retrieve only what's missing in local state
                existing_floats = RTS_STATE["data"].get("floats") or {}
                missing_tickers = [t for t in tickers if t not in existing_floats]
                if missing_tickers:
                    new_floats = get_floats(fmp_api_key, missing_tickers)
                    existing_floats.update(new_floats)
                    for t in missing_tickers:
                        if t not in existing_floats:
                            existing_floats[t] = 0
                
                # Resolve date & extended parameters
                from_date = pd.Timestamp.now('US/Eastern').strftime('%Y-%m-%d') if today_only else ""
                
                session = get_market_session()
                if session == "regular":
                    closes_data = get_closes_with_cache(
                        fmp_api_key, tickers, resolved_interval_ui, 
                        from_date, extended_hours, RTS_STATE["historical_closes_cache"]
                    )
                else:
                    if resolved_interval_ui == "1min":
                        closes_data = get_realtime_1min_closes(fmp_api_key, tickers, from_date=from_date, extended=extended_hours)
                    else:
                        closes_data = get_realtime_5min_closes(fmp_api_key, tickers, from_date=from_date, extended=extended_hours)
                
                RTS_STATE["data"] = {
                    "gainers": gainers,
                    "quotes": quotes,
                    "floats": existing_floats,
                    "closes_5min": closes_data if resolved_interval_ui == "5min" else None,
                    "closes_1min": closes_data if resolved_interval_ui == "1min" else None,
                    "resolved_interval": resolved_interval_ui,
                    "fetch_time": pd.Timestamp.now()
                }
        else:
            st.toast("未能取得最新資料，可能已達 API 上限。已為您保留最新一筆記錄。", icon="⚠️")
            
        st.session_state["rts_refresh_count"] += 1
        st.session_state["last_autorefresh_count"] = -1 # Reset so next autorefresh triggers update
        RTS_STATE["next_refresh_time"] = time.time() + auto_refresh_mins * 60

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
    
    col_gap_lbl, col_gap_chk = st.sidebar.columns([3, 1])
    col_gap_lbl.write("Gap 跳空大於 (%)")
    filter_gap = col_gap_chk.checkbox("篩選", value=True, key="filter_gap")
    min_gap = st.sidebar.number_input("Gap 跳空大於 (%)", value=0.0, step=1.0, label_visibility="collapsed", key="min_gap_val")

    col_gain_lbl, col_gain_chk = st.sidebar.columns([3, 1])
    col_gain_lbl.write("Gainer 漲幅大於 (%)")
    filter_gainer = col_gain_chk.checkbox("篩選", value=True, key="filter_gainer")
    min_gainer = st.sidebar.number_input("Gainer 漲幅大於 (%)", value=5.0, step=1.0, label_visibility="collapsed", key="min_gainer_val")

    col_intra_lbl, col_intra_chk = st.sidebar.columns([3, 1])
    col_intra_lbl.write("開盤到目前漲幅大於 (%)")
    filter_intraday = col_intra_chk.checkbox("篩選", value=True, key="filter_intraday")
    min_intraday = st.sidebar.number_input("開盤到目前漲幅大於 (%)", value=0.0, step=1.0, label_visibility="collapsed", key="min_intraday_val")

    col_intv_lbl, col_intv_chk = st.sidebar.columns([3, 1])
    col_intv_lbl.write(f"最近{actual_window_mins_ui}分鐘最大漲幅大於 (%)")
    filter_interval = col_intv_chk.checkbox("篩選", value=True, key="filter_interval")
    min_interval_pct = st.sidebar.number_input(f"最近{actual_window_mins_ui}分鐘最大漲幅大於 (%)", value=0.0, step=1.0, label_visibility="collapsed", key="min_interval_pct_val")
    
    col_mc_lbl, col_mc_chk = st.sidebar.columns([3, 1])
    col_mc_lbl.write("市值 (M)")
    filter_mc = col_mc_chk.checkbox("篩選", value=True, key="filter_mc")
    col_mc1, col_mc2 = st.sidebar.columns(2)
    min_mc_m = col_mc1.number_input("最低市值 (M)", value=0.0, step=10.0, key="min_mc_m_val")
    max_mc_m = col_mc2.number_input("最高市值 (M)", value=5000.0, step=100.0, key="max_mc_m_val")
    
    col_fl_lbl, col_fl_chk = st.sidebar.columns([3, 1])
    col_fl_lbl.write("Float (M)")
    filter_float = col_fl_chk.checkbox("篩選", value=True, key="filter_float")
    col_fl1, col_fl2 = st.sidebar.columns(2)
    min_float_m = col_fl1.number_input("最低 Float (M)", value=0.0, step=1.0, key="min_float_m_val")
    max_float_m = col_fl2.number_input("最高 Float (M)", value=500.0, step=10.0, key="max_float_m_val")
    
    st.sidebar.markdown("---")
    strict_filter = st.sidebar.checkbox("僅顯示達標標的 (過濾未達標)", value=True, key="strict_filter_val")
    enable_notifications = st.sidebar.checkbox("🔔 啟用瀏覽器桌面通知與音效", value=False, key="enable_notifications")
    
    if enable_notifications:
        import streamlit.components.v1 as components
        js_permission = """
        <script>
        if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
        </script>
        """
        components.html(js_permission, height=0, width=0)

    # 3. Data Loading (From Cache or Initial Fetch)
    data_cache = RTS_STATE["data"]
    
    if data_cache["gainers"] is None:
        with st.spinner("初次載入，正在獲取最新 Top Gainers 資料..."):
            gainers = get_realtime_biggest_gainers(fmp_api_key)
            if gainers:
                tickers = [item['symbol'] for item in gainers if 'symbol' in item]
                with st.spinner(f"正在獲取 {len(tickers)} 檔股票的即時報價與 Float..."):
                    quotes = get_realtime_quotes(fmp_api_key, tickers)
                    
                    # Optimize floats
                    existing_floats = RTS_STATE["data"].get("floats") or {}
                    missing_tickers = [t for t in tickers if t not in existing_floats]
                    if missing_tickers:
                        new_floats = get_floats(fmp_api_key, missing_tickers)
                        existing_floats.update(new_floats)
                        for t in missing_tickers:
                            if t not in existing_floats:
                                existing_floats[t] = 0
                                
                    # Resolve date & extended parameters
                    from_date = pd.Timestamp.now('US/Eastern').strftime('%Y-%m-%d') if today_only else ""
                    
                    session = get_market_session()
                    if session == "regular":
                        closes_data = get_closes_with_cache(
                            fmp_api_key, tickers, resolved_interval_ui, 
                            from_date, extended_hours, RTS_STATE["historical_closes_cache"]
                        )
                    else:
                        if resolved_interval_ui == "1min":
                            closes_data = get_realtime_1min_closes(fmp_api_key, tickers, from_date=from_date, extended=extended_hours)
                        else:
                            closes_data = get_realtime_5min_closes(fmp_api_key, tickers, from_date=from_date, extended=extended_hours)
                    
                    data_cache = {
                        "gainers": gainers,
                        "quotes": quotes,
                        "floats": existing_floats,
                        "closes_5min": closes_data if resolved_interval_ui == "5min" else None,
                        "closes_1min": closes_data if resolved_interval_ui == "1min" else None,
                        "resolved_interval": resolved_interval_ui,
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
    floats_dict = data_cache.get("floats") or {}
    resolved_interval = data_cache.get("resolved_interval", "5min")
    
    # Calculate completed K-line count and actual window minutes
    max_closes = 10
    if resolved_interval == "1min":
        closes_dict = data_cache.get("closes_1min") or {}
        num_candles = min(auto_refresh_mins, max_closes)
        actual_window_mins = num_candles
    else:
        closes_dict = data_cache.get("closes_5min") or {}
        num_candles = min(max(1, auto_refresh_mins // 5), max_closes)
        actual_window_mins = num_candles * 5
        
    pct_col_name = f"最近{actual_window_mins}分鐘最大漲幅 (%)"
    
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
        
        # Suggestion 3: Fetch minimum close in last 10 candles, compute max return
        prev_candle_closes = closes_dict.get(ticker, [])
        
        # Calculate dynamic window sizes
        if resolved_interval == "1min":
            candle_count = min(auto_refresh_mins, len(prev_candle_closes))
        else:
            candle_count = min(max(1, auto_refresh_mins // 5), len(prev_candle_closes))
            
        session = get_market_session()
        if session == "regular":
            # In regular hours, we slide the window: we need completed_count completed candles + 1 active price
            completed_count = max(1, candle_count - 1)
            active_closes = prev_candle_closes[-completed_count:] + [price]
        else:
            # In non-regular hours, closes_list already contains the latest price at the end.
            # To avoid 0% return when window is 1, we ensure we have at least 2 candles.
            window_size = max(2, candle_count)
            active_closes = prev_candle_closes[-window_size:]
            if active_closes:
                price = active_closes[-1]
            
        if active_closes:
            min_close = min(active_closes)
            recent_candle_pct = ((price / min_close - 1) * 100) if min_close > 0 else 0.0
        else:
            recent_candle_pct = 0.0
        
        # Check conditions
        cond_gap = (gap_pct >= min_gap) if filter_gap else True
        cond_gainer = (changes_pct >= min_gainer) if filter_gainer else True
        cond_intraday = (intraday_pct >= min_intraday) if filter_intraday else True
        cond_5min = (recent_candle_pct >= min_interval_pct) if filter_interval else True
        
        # Market Cap bounds
        cond_mc = True
        if filter_mc:
            if min_mc_m > 0: cond_mc = cond_mc and (mc_m >= min_mc_m)
            if max_mc_m > 0: cond_mc = cond_mc and (mc_m <= max_mc_m)
        
        # Float bounds
        cond_float = True
        if filter_float:
            if min_float_m > 0: cond_float = cond_float and (float_m >= min_float_m)
            if max_float_m > 0: cond_float = cond_float and (float_m <= max_float_m)
            
        is_passed = cond_gap and cond_gainer and cond_intraday and cond_5min and cond_mc and cond_float
        
        results.append({
            "Ticker": ticker,
            "Price": round(price, 2),
            "Gap (%)": round(gap_pct, 2),
            "Gainer (%)": round(changes_pct, 2),
            "開盤到目前漲幅 (%)": round(intraday_pct, 2),
            pct_col_name: round(recent_candle_pct, 2) if prev_candle_closes else 0.0,
            "Market Cap (M)": round(mc_m, 2) if mc_m > 0 else None,
            "Float (M)": round(float_m, 2) if float_m > 0 else None,
            "達標 Signal": "✅" if is_passed else "❌",
            "_is_passed": is_passed,
            "_recent_candle_pct": recent_candle_pct
        })
        
    df_results = pd.DataFrame(results)
    
    # DEBUG Console output to verify filtering logic
    print(f"\n[DEBUG] min_interval_pct={min_interval_pct}, filter_interval={filter_interval}, strict_filter={strict_filter}", flush=True)
    for r in results:
        if r["_is_passed"]:
            print(f"  [DEBUG] Passed: {r['Ticker']}, Max Return: {r.get(pct_col_name)}%", flush=True)
    
    # --- Real-time Notification & Watchlist System ---
    current_passed = {r["Ticker"] for r in results if r["_is_passed"]}
    
    # Initialize session state cache if not present
    if "passed_tickers" not in st.session_state:
        st.session_state["passed_tickers"] = current_passed
        newly_passed = set()
    else:
        newly_passed = current_passed - st.session_state["passed_tickers"]
        st.session_state["passed_tickers"] = current_passed
        
    # Maintain global Watchlist state (Suggestion 1)
    now = pd.Timestamp.now()
    watchlist = RTS_STATE.get("watchlist", {})
    
    # 1. Add/Update newly triggered tickers in watchlist
    for r in results:
        ticker = r["Ticker"]
        price = r["Price"]
        if r["_is_passed"]:
            if ticker not in watchlist:
                watchlist[ticker] = {
                    "trigger_time": now,
                    "trigger_price": price,
                    "trigger_pct": r["_recent_candle_pct"],
                    "max_price_since_trigger": price
                }
            else:
                watchlist[ticker]["max_price_since_trigger"] = max(
                    watchlist[ticker]["max_price_since_trigger"],
                    price
                )
        elif ticker in watchlist:
            # If still in watchlist but no longer passed current filters, update its max price if current price is higher
            watchlist[ticker]["max_price_since_trigger"] = max(
                watchlist[ticker]["max_price_since_trigger"],
                price
            )
            
    # 2. Expiry checks
    expiry_secs = watchlist_expiry_mins * 60
    expired_tickers = []
    for ticker, info in watchlist.items():
        elapsed_secs = (now - info["trigger_time"]).total_seconds()
        if elapsed_secs > expiry_secs:
            expired_tickers.append(ticker)
            
    for ticker in expired_tickers:
        if ticker in watchlist:
            del watchlist[ticker]
            
    RTS_STATE["watchlist"] = watchlist
        
    # Trigger audio & desktop alerts for new tickers
    if enable_notifications and newly_passed:
        import streamlit.components.v1 as components
        tickers_str = ", ".join(sorted(newly_passed))
        js_code = f"""
        <script>
        function triggerAlert() {{
            // 1. Play Web Audio API double-beep (works robustly in background tabs without external files)
            try {{
                var context = new (window.AudioContext || window.webkitAudioContext)();
                function playBeep(delay, frequency, duration) {{
                    var osc = context.createOscillator();
                    var gain = context.createGain();
                    osc.connect(gain);
                    gain.connect(context.destination);
                    osc.type = "sine";
                    osc.frequency.value = frequency;
                    gain.gain.setValueAtTime(0.2, context.currentTime + delay);
                    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + delay + duration);
                    osc.start(context.currentTime + delay);
                    osc.stop(context.currentTime + delay + duration);
                }}
                playBeep(0, 880, 0.15);
                playBeep(0.2, 880, 0.15);
            }} catch(e) {{
                console.log("Audio play error: " + e);
            }}
            
            // 2. Desktop notification
            if ("Notification" in window) {{
                if (Notification.permission === "granted") {{
                    new Notification("⚡ Screener 達標通知", {{
                        body: "股票 {tickers_str} 滿足您設定的篩選條件！",
                        icon: "https://cdn-icons-png.flaticon.com/512/179/179386.png"
                    }});
                }}
            }}
        }}
        triggerAlert();
        </script>
        """
        components.html(js_code, height=0, width=0)
        
    # Render Radar Table
    st.subheader("📡 即時雷達 (Real-time Radar)")
    if strict_filter and not df_results.empty:
        df_results = df_results[df_results["_is_passed"]]
        
    if not df_results.empty:
        df_results = df_results.drop(columns=["_is_passed"])
        def color_returns(val):
            if isinstance(val, (int, float)):
                color = 'green' if val > 0 else 'red' if val < 0 else 'white'
                return f'color: {color}'
            return ''
            
        styled_df = df_results.style.format(na_rep="N/A").map(color_returns, subset=["Gap (%)", "Gainer (%)", "開盤到目前漲幅 (%)", pct_col_name])
        st.dataframe(styled_df, width="stretch", hide_index=True)
    else:
        st.warning("目前沒有任何股票符合您的即時篩選條件。")

    # Render Watchlist Table (Suggestion 1: Active Pullback Watchlist)
    st.markdown("---")
    
    col_wl_title, col_wl_btn = st.columns([5, 1])
    col_wl_title.subheader(f"📈 達標活躍觀察池 (Active Pullback Watchlist - 保留 {watchlist_expiry_mins} 分鐘)")
    if col_wl_btn.button("🗑️ 清空觀察池", key="clear_watchlist_btn", use_container_width=True):
        RTS_STATE["watchlist"] = {}
        st.toast("觀察池已清空！", icon="🧹")
        st.rerun()
    
    if watchlist:
        watchlist_rows = []
        for ticker, info in watchlist.items():
            # Get latest price from quotes_dict
            quote = quotes_dict.get(ticker, {})
            current_price = quote.get('price', info["trigger_price"])
            
            # Update max price in session display
            max_price = max(info["max_price_since_trigger"], current_price)
            pullback_pct = ((current_price / max_price - 1) * 100) if max_price > 0 else 0.0
            
            elapsed_secs = (now - info["trigger_time"]).total_seconds()
            elapsed_mins = int(elapsed_secs // 60)
            elapsed_secs_remain = int(elapsed_secs % 60)
            elapsed_str = f"{elapsed_mins}分{elapsed_secs_remain}秒前"
            
            watchlist_rows.append({
                "Ticker": ticker,
                "觸發時間": info["trigger_time"].strftime("%H:%M:%S"),
                "已追蹤時間": elapsed_str,
                "觸發價格": round(info["trigger_price"], 2),
                "觸發%": round(info.get("trigger_pct", 0.0), 2),
                "回檔%": round(pullback_pct, 2)
            })
            
        df_watchlist = pd.DataFrame(watchlist_rows)
        
        def color_pullback(val):
            if isinstance(val, (int, float)):
                # Pullbacks are negative or 0. Red represents pullback severity.
                color = 'red' if val < 0 else 'white'
                return f'color: {color}'
            return ''
            
        styled_watchlist = df_watchlist.style.map(color_pullback, subset=["回檔%"])
        st.dataframe(styled_watchlist, width="stretch", hide_index=True)
    else:
        st.info("目前觀察池內無達標標的。當有股票滿足篩選條件時，會自動加入此處供您追蹤 Pullback 買點。")

if __name__ == "__main__":
    render_page()
