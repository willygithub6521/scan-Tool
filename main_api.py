import os
import time
import datetime
import concurrent.futures
from typing import List, Dict, Any, Optional
import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load environment variables from .env if it exists
if os.path.exists(".env"):
    with open(".env", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

from data_fetcher import (
    get_historical_data,
    get_basic_info,
    get_fmp_screener_tickers,
    get_aftermarket_quote,
    get_stock_news,
    get_realtime_biggest_gainers,
    get_realtime_quotes,
    get_floats,
    get_realtime_5min_closes,   # [DEPRECATED] kept for /api/screener/realtime backward compat
    get_realtime_1min_closes,   # [DEPRECATED] kept for /api/screener/realtime backward compat
    get_intraday_data
)
from indicators import add_sma
from backtrader_engine import run_backtrader, run_backtrader_5min

app = FastAPI(title="Stock Scanner API", version="1.0.0")

# Setup CORS to allow Vite React app to communicate
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for security in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global in-memory cache for raw historical DataFrames to avoid redundant FMP/Yahoo API requests
RAW_DATA_CACHE: Dict[str, pd.DataFrame] = {}

# ─── Batch-Quote Ring Buffer Architecture ─────────────────────────────────────
from collections import defaultdict, deque

# Per-ticker ring buffer of (timestamp, price) tuples sampled every 5 seconds.
# maxlen=360 retains up to 30 minutes of data at 12 samples/min.
PRICE_BUFFER: Dict[str, deque] = defaultdict(lambda: deque(maxlen=360))

# Cache for the Top Gainers list (updated every autoRefreshMins by background thread)
GAINERS_CACHE: Dict[str, Any] = {
    "tickers": [],       # list[str] of symbols
    "gainers_raw": [],   # full raw gainers response from FMP
    "updated_at": None   # datetime of last refresh
}

# Last known API key (set on each /api/screener/tick call, used by background thread)
LAST_API_KEY: str = ""
# Last autoRefreshMins setting (used to control gainers refresh interval)
LAST_AUTO_REFRESH_MINS: int = 1
# Track the last time RealTimeScreener sent a tick (used for lazy keep-alive)
LAST_SCREENER_REQUEST_TIME: float = 0.0
# ─────────────────────────────────────────────────────────────────────────────

# [DEPRECATED] Legacy SCREENER_CACHE kept for /api/screener/realtime backward compat
SCREENER_CACHE: Dict[str, Any] = {
    "cache_key": "",
    "gainers": [],
    "floats": {},
    "closes": {},
    "updated_at": None
}

# Ticker-level individual floats cache
GLOBAL_FLOATS_CACHE: Dict[str, float] = {}

def get_floats_optimized(key: str, tickers: List[str]) -> Dict[str, float]:
    global GLOBAL_FLOATS_CACHE
    result = {}
    missing_tickers = []
    
    for t in tickers:
        if t in GLOBAL_FLOATS_CACHE:
            result[t] = GLOBAL_FLOATS_CACHE[t]
        else:
            missing_tickers.append(t)
            
    if missing_tickers:
        from data_fetcher import get_floats
        # Fetch floats only for missing tickers
        fetched = get_floats(key, missing_tickers)
        for t, val in fetched.items():
            GLOBAL_FLOATS_CACHE[t] = val
            result[t] = val
            
    return result

def background_gainers_refresh_thread():
    """Background daemon: refreshes Top Gainers list + floats every autoRefreshMins minutes.
    
    This is the simplified replacement for the old prewarm thread. It no longer fetches
    K-line data or manages a warming/ready state machine. The frontend drives tick updates
    directly every 5 seconds via /api/screener/tick.
    """
    global GAINERS_CACHE, GLOBAL_FLOATS_CACHE, LAST_API_KEY, LAST_AUTO_REFRESH_MINS, LAST_SCREENER_REQUEST_TIME

    print("Background gainers refresh thread started.", flush=True)

    while True:
        try:
            time.sleep(1)
            now = datetime.datetime.now()
            # Refresh at second=3 of every Nth minute (N = autoRefreshMins)
            refresh_interval_secs = LAST_AUTO_REFRESH_MINS * 60
            last_updated = GAINERS_CACHE.get("updated_at")
            secs_since_update = (now - last_updated).total_seconds() if last_updated else 99999
            
            # Lazy Keep-Alive: skip if screener hasn't ticked recently
            secs_since_tick = time.time() - LAST_SCREENER_REQUEST_TIME
            sleep_threshold_secs = (LAST_AUTO_REFRESH_MINS + 3) * 60

            key = LAST_API_KEY or os.environ.get("FMP_API_KEY", "")
            should_refresh = (
                now.second == 3
                and key
                and secs_since_update >= refresh_interval_secs
                and secs_since_tick <= sleep_threshold_secs
            )

            if should_refresh:
                print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] Refreshing Top Gainers...", flush=True)
                try:
                    gainers = get_realtime_biggest_gainers(key)
                    if gainers:
                        tickers = [g["symbol"] for g in gainers if "symbol" in g]
                        floats_dict = get_floats_optimized(key, tickers)
                        GAINERS_CACHE["tickers"] = tickers
                        GAINERS_CACHE["gainers_raw"] = gainers
                        GAINERS_CACHE["updated_at"] = now
                        print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] Gainers refreshed: {len(tickers)} tickers.", flush=True)
                    else:
                        print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] Gainers refresh skipped: no results.", flush=True)
                except Exception as inner_e:
                    print(f"[{now.strftime('%Y-%m-%d %H:%M:%S')}] Gainers refresh failed: {inner_e}", flush=True)
                time.sleep(2)  # Avoid double trigger within the same second
        except Exception as e:
            print(f"[GainersRefresh] Exception: {e}", flush=True)

# Start daemon gainers refresh thread only when FastAPI starts
@app.on_event("startup")
def startup_event():
    import threading
    threading.Thread(target=background_gainers_refresh_thread, daemon=True).start()


def sanitize_value(val):
    """Recursively clean dicts/lists to convert numpy types and replace NaN/Infinity with None"""
    if isinstance(val, dict):
        return {k: sanitize_value(v) for k, v in val.items()}
    elif isinstance(val, list):
        return [sanitize_value(v) for v in val]
    elif isinstance(val, float):
        if np.isnan(val) or np.isinf(val):
            return None
        return val
    elif isinstance(val, (int, str, bool)) or val is None:
        return val
    elif isinstance(val, np.integer):
        return int(val)
    elif isinstance(val, np.floating):
        f_val = float(val)
        if np.isnan(f_val) or np.isinf(f_val):
            return None
        return f_val
    elif isinstance(val, np.ndarray):
        return [sanitize_value(x) for x in val.tolist()]
    return str(val)

class ScanRequest(BaseModel):
    data_source: str = "FMP"  # "FMP" or "Yahoo Finance"
    fmp_api_key: Optional[str] = None
    input_method: str = "手動輸入"  # "手動輸入", "CSV 上傳", "FMP 伺服器端進階篩選"
    tickers: List[str] = []
    fmp_server_params: Optional[Dict[str, Any]] = None
    period: str = "1y"
    sma_window: int = 50
    show_sma_cols: bool = False
    min_1d_return: float = 50.0
    n_days_return: int = 5
    min_nd_return: float = 50.0
    match_logic: str = "OR (任一條件達標即可)"  # "OR (任一條件達標即可)" or "AND (全部條件皆須達標)"
    strict_return_filter: bool = False
    strategy_select: str = "1.Extended Short"  # "1.Extended Short", "2.Fake Breakout Short", "3.QullaMaggie Breakout", "4.曾經單日漲幅Breakout"
    hist_cfg: Dict[str, Any] = {}
    strict_history_filter: bool = False
    vol_multiplier: float = 10.0
    strict_vol_filter: bool = False
    prefetched_info: Optional[Dict[str, Dict[str, Any]]] = None

class RealtimeScreenerRequest(BaseModel):
    """[DEPRECATED] Legacy model for /api/screener/realtime. Use RealtimeTickRequest instead."""
    fmp_api_key: Optional[str] = None
    auto_refresh_mins: int = 5
    intraday_interval: str = "Auto (根據更新頻率)"
    today_only: bool = True
    extended_hours: bool = True
    watchlist_expiry_mins: int = 15
    min_gap: float = 0.0
    min_gainer: float = 5.0
    min_intraday: float = 0.0
    min_interval_pct: float = 0.0
    recent_mins_window: int = 5
    min_mc_m: float = 0.0
    max_mc_m: float = 5000.0
    min_float_m: float = 0.0
    max_float_m: float = 500.0
    min_price: float = 0.0
    max_price: float = 0.0
    filter_price: bool = True
    filter_gap: bool = True
    filter_gainer: bool = True
    filter_intraday: bool = True
    filter_interval: bool = True
    filter_mc: bool = True
    filter_float: bool = True
    strict_filter: bool = True
    watchlist: Dict[str, Any] = {}  # Frontend state passed to keep API stateless
    lightweight: bool = False

class RealtimeTickRequest(BaseModel):
    """Request model for /api/screener/tick (5-second batch-quote ring buffer architecture)."""
    fmp_api_key: Optional[str] = None
    auto_refresh_mins: int = 1           # Controls how often background gainers list refreshes
    recent_mins_window: int = 5          # Rolling price window for recent gain calculation
    watchlist_expiry_mins: int = 15
    min_gap: float = 0.0
    min_gainer: float = 5.0
    min_intraday: float = 0.0
    min_interval_pct: float = 0.0
    min_mc_m: float = 0.0
    max_mc_m: float = 5000.0
    min_float_m: float = 0.0
    max_float_m: float = 500.0
    min_volume_m: float = 0.0
    max_volume_m: float = 500.0
    min_price: float = 0.0
    max_price: float = 0.0
    filter_price: bool = True
    filter_gap: bool = True
    filter_gainer: bool = True
    filter_intraday: bool = True
    filter_interval: bool = True
    filter_mc: bool = True
    filter_float: bool = True
    filter_volume: bool = False
    strict_filter: bool = False
    watchlist: Dict[str, Any] = {}
    custom_tickers: List[str] = []

class VectorizedBacktestRequest(BaseModel):
    tickers: List[str]
    data_source: str = "FMP"
    fmp_api_key: Optional[str] = None
    period: str = "5y"
    strategy_choice: str = "極端暴漲當沖放空 (Gap-Up Momentum Short)"
    cond1_pct: float = 90.0
    cond2_pct: float = 70.0
    tp_pct: float = 15.0
    sl_pct: float = 5.0
    sma_fast: int = 20
    sma_slow: int = 60

class BacktraderRequest(BaseModel):
    tickers: List[str]
    data_source: str = "FMP"
    fmp_api_key: Optional[str] = None
    period: str = "5y"
    starting_cash: float = 100000.0
    is_fixed_comm: bool = False
    commission_val: float = 0.001
    strategy: str = "A. 雙均線波段做多 (含動態止盈止損)"  # Strategy selector
    stake_mode: str = "shares"  # "shares" or "cash"
    stake_val: float = 100.0
    # Strategy parameters
    sma_fast: int = 20
    sma_slow: int = 60
    cond1_pct: float = 90.0
    cond2_pct: float = 70.0
    tp_pct: float = 15.0
    sl_pct: float = 5.0
    max_hold: int = 1

def resolve_interval(intraday_interval: str, recent_mins_window: int) -> str:
    """[DEPRECATED] Helper for /api/screener/realtime K-line interval resolution."""
    if "Auto" in intraday_interval:
        return "1min" if recent_mins_window < 5 else "5min"
    elif "1min" in intraday_interval:
        return "1min"
    return "5min"

def get_market_session_status():
    """Helper to detect US Eastern market session"""
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
    except Exception:
        return "closed"

@app.get("/api/session")
def get_session():
    now_est = pd.Timestamp.now('US/Eastern')
    gainers_updated = GAINERS_CACHE.get("updated_at")
    gainers_age_secs = int((datetime.datetime.now() - gainers_updated).total_seconds()) if gainers_updated else None
    return sanitize_value({
        "session": get_market_session_status(),
        "est_time": now_est.strftime("%Y-%m-%d %H:%M:%S"),
        "gainers_count": len(GAINERS_CACHE.get("tickers", [])),
        "gainers_age_secs": gainers_age_secs,
    })

# /api/session/consume has been removed (no longer needed without prewarm state machine)

@app.get("/api/stocks/{ticker}/historical")
def get_historical(
    ticker: str,
    provider: str = "Yahoo Finance",
    period: str = "1y",
    api_key: Optional[str] = None,
    sma_window: int = 50
):
    key = api_key or os.environ.get("FMP_API_KEY", "")
    try:
        # Try retrieving from RAM cache first
        df = RAW_DATA_CACHE.get(ticker)
        if df is None or df.empty:
            df = get_historical_data(ticker, provider, period, key)
            if not df.empty:
                RAW_DATA_CACHE[ticker] = df

        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data found for ticker {ticker}")

        df = add_sma(df, window=sma_window)
        
        # Standardize index name to prevent KeyError on different providers
        df.index.name = 'date'
        df_reset = df.reset_index()

        data = []
        for _, row in df_reset.iterrows():
            item = {
                "time": row['date'].strftime('%Y-%m-%d') if isinstance(row['date'], (pd.Timestamp, datetime.date)) else str(row['date']),
                "open": float(row['Open']),
                "high": float(row['High']),
                "low": float(row['Low']),
                "close": float(row['Close']),
                "volume": float(row['Volume'])
            }
            sma_col = f"SMA_{sma_window}"
            if sma_col in row and not pd.isna(row[sma_col]):
                item["sma"] = float(row[sma_col])
            data.append(item)

        return sanitize_value({
            "ticker": ticker,
            "data": data
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stocks/{ticker}/deep-dive")
def get_deep_dive(
    ticker: str,
    provider: str = "FMP",
    api_key: Optional[str] = None
):
    key = api_key or os.environ.get("FMP_API_KEY", "")
    try:
        quote = {}
        news = []
        if provider == "FMP" and key:
            quote = get_aftermarket_quote(ticker, provider, key)
            news = get_stock_news(ticker, provider, key, limit=3)
        return sanitize_value({
            "ticker": ticker,
            "aftermarket_quote": quote,
            "news": news
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class FmpScreenerRequest(BaseModel):
    fmp_api_key: Optional[str] = None
    params: dict = {}

@app.post("/api/fmp-screener")
def fmp_screener(req: FmpScreenerRequest):
    key = req.fmp_api_key or os.environ.get("FMP_API_KEY", "")
    if not key:
        raise HTTPException(status_code=400, detail="FMP API Key is required")
    screener_results = get_fmp_screener_tickers(key, req.params)
    return sanitize_value({"results": screener_results})

@app.post("/api/scan")
def post_scan(req: ScanRequest):
    key = req.fmp_api_key or os.environ.get("FMP_API_KEY", "")
    if req.data_source == "FMP" and not key:
        raise HTTPException(status_code=400, detail="FMP API Key is required for FMP data source.")

    tickers = req.tickers
    ticker_info_cache = {}

    # Step 1: Resolve tickers list
    if req.input_method == "FMP 伺服器端進階篩選":
        params = req.fmp_server_params or {}
        screener_results = get_fmp_screener_tickers(key, params)
        tickers = []
        for item in screener_results:
            if "symbol" in item:
                sym = item["symbol"]
                tickers.append(sym)
                ticker_info_cache[sym] = {
                    "shortName": item.get("companyName", sym),
                    "sector": item.get("sector", "N/A"),
                    "marketCap": item.get("marketCap", "N/A")
                }
        if not tickers:
            return sanitize_value({"results": []})

    if req.strategy_select == "4.曾經單日漲幅Breakout" and key:
        try:
            get_floats_optimized(key, tickers)
        except Exception as e:
            print(f"Error fetching floats in post_scan: {e}")

    # Merge prefetched info if provided
    if req.prefetched_info:
        for t, info in req.prefetched_info.items():
            ticker_info_cache[t] = info

    # Step 2: Parallel fetch and process K-lines
    temp_results = []
    
    def process_ticker(ticker):
        try:
            df = get_historical_data(ticker, req.data_source, req.period, key)
            if df.empty or len(df) < req.sma_window:
                return None
            
            latest_data = df.iloc[-1]
            # Date freshness check (exclude inactive stocks older than 7 days)
            if pd.Timestamp(latest_data.name) < pd.Timestamp.now() - pd.Timedelta(days=7):
                return None

            # Get Profile/Basic Info
            if ticker in ticker_info_cache:
                info = ticker_info_cache[ticker]
            else:
                info = get_basic_info(ticker, req.data_source, key)

            return {"ticker": ticker, "df": df, "info": info}
        except Exception:
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(process_ticker, t): t for t in tickers}
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                temp_results.append(res)
                # Store in RAM cache for interactive charting & backtesting
                RAW_DATA_CACHE[res["ticker"]] = res["df"]

    # Step 3: Run filtering logic in Python
    filtered_results = []
    for item in temp_results:
        ticker = item["ticker"]
        df = item["df"]
        info = item["info"]
        
        latest_data = df.iloc[-1]
        
        # Add SMA
        df = add_sma(df, window=req.sma_window)
        latest_data = df.iloc[-1]
        
        # Basic calculations
        r1 = (df['Close'].iloc[-1] / df['Close'].iloc[-2] - 1) * 100 if len(df) >= 2 else 0.0
        rn = (df['Close'].iloc[-1] / df['Close'].iloc[-1 - req.n_days_return] - 1) * 100 if len(df) >= req.n_days_return + 1 else 0.0
        
        vol_sma_20 = df['Volume'].rolling(window=20).mean().iloc[-1] if len(df) >= 20 else 0
        vol_today = df['Volume'].iloc[-1]
        rvol = (vol_today / vol_sma_20) if vol_sma_20 > 0 else 0.0
        
        cond_price_sma = latest_data['Close'] > latest_data[f'SMA_{req.sma_window}']
        cond_1d = r1 >= req.min_1d_return
        cond_nd = rn >= req.min_nd_return
        
        is_strict_passed = (cond_1d or cond_nd) if "OR" in req.match_logic else (cond_1d and cond_nd)
        cond_vol = rvol >= req.vol_multiplier

        # Strategy specific historical filters
        hist_match = False
        ext_date = ""
        ext_ret = 0.0
        adv_ret = "N/A"
        qm_recent_ret = 0.0

        if req.strategy_select == "1.Extended Short":
            daily_ret = (df['Close'] / df['Close'].shift(1) - 1) * 100
            open_close_ret = (df['Close'] / df['Open'] - 1) * 100
            min_daily_ret = req.hist_cfg.get('min_daily_ret', 90.0)
            min_body_ret = req.hist_cfg.get('min_body_ret', 70.0)
            valid_mask = (daily_ret >= min_daily_ret) & (open_close_ret >= min_body_ret)
            
            if 'time_range' in req.hist_cfg:
                min_m, max_m = req.hist_cfg['time_range']
                latest_date = df.index[-1]
                start_date = latest_date - pd.DateOffset(months=max_m)
                end_date = latest_date - pd.DateOffset(months=min_m)
                time_mask = (df.index >= start_date) & (df.index <= end_date)
                valid_mask = valid_mask & time_mask
                
            if req.hist_cfg.get('enable_adv'):
                n_days = req.hist_cfg.get('adv_n_days', 1)
                future_ret = (df['Close'].shift(-n_days) / df['Close'] - 1) * 100
                if req.hist_cfg.get('enable_adv'):
                    adv_ret_val = req.hist_cfg.get('adv_ret_val', 0.0)
                    if req.hist_cfg.get('adv_ret_dir') == "漲":
                        if req.hist_cfg.get('adv_ret_type') == "大於":
                            adv_mask = future_ret >= adv_ret_val
                        else:
                            adv_mask = (future_ret > 0) & (future_ret <= adv_ret_val)
                    else: # 跌
                        if req.hist_cfg.get('adv_ret_type') == "大於":
                            adv_mask = future_ret <= -adv_ret_val
                        else:
                            adv_mask = (future_ret < 0) & (future_ret >= -adv_ret_val)
                    valid_mask = valid_mask & adv_mask
            
            hist_match = bool(valid_mask.any())
            if hist_match:
                latest_date_idx = df[valid_mask].index[-1]
                ext_date = latest_date_idx.strftime('%Y-%m-%d')
                ext_ret = float(daily_ret.loc[latest_date_idx])
                if req.hist_cfg.get('enable_adv'):
                    n_days = req.hist_cfg.get('adv_n_days', 1)
                    future_ret = (df['Close'].shift(-n_days) / df['Close'] - 1) * 100
                    adv_val = future_ret.loc[latest_date_idx]
                    adv_ret = round(float(adv_val), 2) if not pd.isna(adv_val) else "N/A"

        elif req.strategy_select == "2.Fake Breakout Short":
            gap_up = (df['Open'] / df['Close'].shift(1) - 1) * 100
            vol_m = df['Volume'] / 1e6
            prev_close = df['Close'].shift(1)
            range_size = (df['High'] - df['Low'])
            upper_shadow = (df['High'] - df[['Open', 'Close']].max(axis=1))
            shadow_ratio = (upper_shadow / range_size * 100).fillna(0)
            
            min_gap = req.hist_cfg.get('min_gap', 30.0)
            min_vol_m = req.hist_cfg.get('min_vol_m', 10.0)
            min_prev_close = req.hist_cfg.get('min_prev_close', 1.0)
            min_shadow_ratio = req.hist_cfg.get('min_shadow_ratio', 60.0)
            
            valid_mask = ((gap_up >= min_gap) & 
                          (vol_m >= min_vol_m) & 
                          (prev_close >= min_prev_close) & 
                          (shadow_ratio >= min_shadow_ratio))
                          
            if 'time_range' in req.hist_cfg:
                min_m, max_m = req.hist_cfg['time_range']
                latest_date = df.index[-1]
                start_date = latest_date - pd.DateOffset(months=max_m)
                end_date = latest_date - pd.DateOffset(months=min_m)
                time_mask = (df.index >= start_date) & (df.index <= end_date)
                valid_mask = valid_mask & time_mask
                
            hist_match = bool(valid_mask.any())
            if hist_match:
                latest_date_idx = df[valid_mask].index[-1]
                ext_date = latest_date_idx.strftime('%Y-%m-%d')
                ext_ret = float(gap_up.loc[latest_date_idx])

        elif req.strategy_select == "3.QullaMaggie Breakout":
            qm_days = int(req.hist_cfg.get('qm_days', 20))
            if len(df) >= qm_days + 1:
                rolling_ret = (df['Close'] / df['Close'].shift(qm_days) - 1) * 100
                qm_recent_ret = float(rolling_ret.iloc[-1])
                qm_min_ret = req.hist_cfg.get('qm_min_ret', 30.0)
                hist_match = bool(qm_recent_ret >= qm_min_ret)
            else:
                hist_match = False

        elif req.strategy_select == "4.曾經單日漲幅Breakout":
            qm_days = int(req.hist_cfg.get('qm_days', 20))
            use_body = req.hist_cfg.get('use_body_filter', False)
            min_body = req.hist_cfg.get('min_body_ret', 0.0)
            
            if len(df) > 1:
                recent_df = df.tail(qm_days + 1).copy()
                daily_rets = (recent_df['Close'] / recent_df['Close'].shift(1) - 1) * 100
                body_rets = (recent_df['Close'] / recent_df['Open'] - 1) * 100
                
                cond = daily_rets >= req.hist_cfg.get('qm_min_ret', 30.0)
                if use_body:
                    cond = cond & (body_rets >= min_body)
                    
                match_days = recent_df[cond]
                if not match_days.empty:
                    hist_match = True
                    best_day_idx = daily_rets[cond].idxmax()
                    qm_recent_ret = float(daily_rets.loc[best_day_idx])
                    ext_date = best_day_idx.strftime('%Y-%m-%d')
                    ext_vol = float(recent_df.loc[best_day_idx, 'Volume']) / 1e6
                else:
                    hist_match = False
                    qm_recent_ret = 0.0
                    ext_date = ""
                    ext_vol = 0.0
            else:
                hist_match = False
                qm_recent_ret = 0.0
                ext_date = ""
                ext_vol = 0.0

        # Server-side filtering removed to allow client-side immediate toggle
        
        market_cap_val = info.get('marketCap', 'N/A')
        if isinstance(market_cap_val, (int, float)):
            market_cap_str = f"${market_cap_val / 1e6:.2f}M"
        else:
            market_cap_str = market_cap_val

        # Compile matching object
        row_dict = {
            "Ticker": ticker,
            "Name": info.get('shortName', ticker),
            "Sector": info.get('sector', 'N/A'),
            "Market Cap": market_cap_str,
            "Close": round(float(latest_data['Close']), 2),
        }

        if req.show_sma_cols:
            row_dict[f"SMA_{req.sma_window}"] = round(float(latest_data[f'SMA_{req.sma_window}']), 2)
            row_dict["Price > SMA"] = "✅" if cond_price_sma else "❌"

        # Always attach return metrics
        row_dict["1日漲幅(%)"] = round(r1, 2)
        row_dict[f"{req.n_days_return}日漲幅(%)"] = round(rn, 2)
        row_dict["1日漲幅達標"] = "✅" if cond_1d else "❌"
        row_dict[f"{req.n_days_return}日漲幅達標"] = "✅" if cond_nd else "❌"

        # Always attach history metrics
        hist_col_name = "歷史暴漲達標"
        if req.strategy_select == "1.Extended Short":
            hist_col_name = "歷史暴漲達標"
            row_dict["歷史暴漲日期"] = ext_date
            row_dict["歷史暴漲幅度(%)"] = round(ext_ret, 2)
            if req.hist_cfg.get('enable_adv'):
                row_dict[f"隔{req.hist_cfg.get('adv_n_days', 1)}日漲跌幅(%)"] = adv_ret
        elif req.strategy_select == "2.Fake Breakout Short":
            hist_col_name = "歷史假突破達標"
            row_dict["歷史假突破日期"] = ext_date
            row_dict["假突破Gap(%)"] = round(ext_ret, 2)
        elif req.strategy_select == "3.QullaMaggie Breakout":
            hist_col_name = "QullaMaggie突破達標"
            qm_days = int(req.hist_cfg.get('qm_days', 20))
            row_dict[f"QM_{qm_days}日內近期漲幅(%)"] = round(qm_recent_ret, 2)
        else:
            hist_col_name = "單日漲幅Breakout達標"
            qm_days = int(req.hist_cfg.get('qm_days', 20))
            row_dict[f"過去{qm_days}日內最大單日漲幅(%)"] = round(qm_recent_ret, 2)
            row_dict["達標日期"] = ext_date
            row_dict["當日Volume(M)"] = round(ext_vol, 2) if ext_vol > 0 else 0
            
            fm = GLOBAL_FLOATS_CACHE.get(ticker, 0) / 1e6 if GLOBAL_FLOATS_CACHE.get(ticker, 0) else 0
            row_dict["Float(M)"] = f"{fm:.2f}M" if fm > 0 else "N/A"
            if ext_date and hist_match:
                row_dict["📰 News"] = f"https://www.google.com/search?tbm=nws&q={ticker}+stock+{ext_date}"
            else:
                row_dict["📰 News"] = ""
        row_dict[hist_col_name] = "✅" if hist_match else "❌"

        # Always attach volume metrics
        row_dict["RVOL (倍)"] = round(rvol, 2)
        row_dict["爆量達標"] = "✅" if cond_vol else "❌"

        filtered_results.append(row_dict)

    return sanitize_value({"results": filtered_results})

@app.post("/api/screener/tick")
def post_screener_tick(req: RealtimeTickRequest):
    """Primary real-time screener endpoint (batch-quote ring buffer architecture).
    
    Called by the frontend every 5 seconds. Each call:
    1. Fetches batch-quote for all gainers + watchlist tickers (1 API call total)
    2. Appends (timestamp, price) to PRICE_BUFFER for each ticker
    3. Calculates recent N-minute max gain from the ring buffer
    4. Updates watchlist (including watchlist-only tickers no longer in gainers)
    """
    global LAST_API_KEY, LAST_AUTO_REFRESH_MINS, PRICE_BUFFER, LAST_SCREENER_REQUEST_TIME

    key = req.fmp_api_key or os.environ.get("FMP_API_KEY", "")
    if not key:
        raise HTTPException(status_code=400, detail="FMP API Key is required.")

    # Update API key, refresh interval, and lazy keep-alive tracking
    LAST_API_KEY = key
    LAST_AUTO_REFRESH_MINS = req.auto_refresh_mins
    LAST_SCREENER_REQUEST_TIME = time.time()

    # 1. Decide tickers: gainers ∪ watchlist (deduped, gainers first)
    gainers_tickers = list(GAINERS_CACHE.get("tickers", []))
    gainers_raw = GAINERS_CACHE.get("gainers_raw", [])

    # Cold-start: if gainers cache is empty, fetch immediately and block
    if not gainers_tickers:
        print("[Tick] Cold-start: fetching initial gainers synchronously...", flush=True)
        try:
            gainers = get_realtime_biggest_gainers(key)
            if gainers:
                gainers_tickers = [g["symbol"] for g in gainers if "symbol" in g]
                gainers_raw = gainers
                floats_dict = get_floats_optimized(key, gainers_tickers)
                GAINERS_CACHE["tickers"] = gainers_tickers
                GAINERS_CACHE["gainers_raw"] = gainers_raw
                GAINERS_CACHE["updated_at"] = datetime.datetime.now()
        except Exception as e:
            print(f"[Tick] Cold-start gainers fetch failed: {e}", flush=True)
            return sanitize_value({"results": [], "watchlist": req.watchlist, "new_notifications": []})

    watchlist_tickers = list(req.watchlist.keys())
    # Merge: gainers first, then watchlist, then custom (preserve order, no duplicates)
    all_tickers = list(dict.fromkeys(gainers_tickers + watchlist_tickers + req.custom_tickers))
    
    # Pre-fetch floats for any missing tickers in the pool
    _ = get_floats_optimized(key, all_tickers)

    # 2. Single batch-quote call for all tickers
    quotes = get_realtime_quotes(key, all_tickers)
    quotes_dict = {q["symbol"]: q for q in quotes if "symbol" in q}

    # 3. Append price samples to PRICE_BUFFER (ring buffer, auto-trims maxlen=360)
    ts = time.time()
    for ticker in all_tickers:
        q = quotes_dict.get(ticker, {})
        price = q.get("price", 0)
        if price and price > 0:
            PRICE_BUFFER[ticker].append((ts, price))

    # 4. Calculate metrics per ticker and build results
    session = get_market_session_status()
    window_secs = req.recent_mins_window * 60
    results = []

    for ticker in gainers_tickers:  # Only gainers appear in the results table
        q = quotes_dict.get(ticker, {})
        price = q.get("price", 0)
        open_price = q.get("open", 0)
        prev_close = q.get("previousClose", 0)
        changes_pct = q.get("changePercentage", 0)
        market_cap = q.get("marketCap", 0)

        gap_pct = ((open_price / prev_close - 1) * 100) if prev_close and prev_close > 0 else 0
        intraday_pct = ((price / open_price - 1) * 100) if open_price and open_price > 0 else 0
        mc_m = market_cap / 1e6 if market_cap else 0

        float_shares = GLOBAL_FLOATS_CACHE.get(ticker, 0)
        float_m = float_shares / 1e6 if float_shares else 0

        volume = q.get("volume", 0)
        vol_m = volume / 1e6 if volume else 0

        # Calculate recent N-minute max gain from ring buffer
        cutoff = ts - window_secs
        buf = PRICE_BUFFER.get(ticker, deque())
        prices_in_window = [p for t, p in buf if t >= cutoff and p > 0]

        if prices_in_window and price and price > 0:
            min_price = min(prices_in_window)
            recent_pct = ((price / min_price) - 1) * 100
        else:
            recent_pct = 0.0

        # Filter criteria
        cond_gap = (gap_pct >= req.min_gap) if req.filter_gap else True
        cond_gainer = (changes_pct >= req.min_gainer) if req.filter_gainer else True
        cond_intraday = (intraday_pct >= req.min_intraday) if req.filter_intraday else True
        cond_interval = (recent_pct >= req.min_interval_pct) if req.filter_interval else True

        cond_mc = True
        if req.filter_mc:
            if req.min_mc_m > 0: cond_mc = cond_mc and (mc_m >= req.min_mc_m)
            if req.max_mc_m > 0: cond_mc = cond_mc and (mc_m <= req.max_mc_m)

        cond_float = True
        if req.filter_float:
            if req.min_float_m > 0: cond_float = cond_float and (float_m >= req.min_float_m)
            if req.max_float_m > 0: cond_float = cond_float and (float_m <= req.max_float_m)

        cond_price = True
        if req.filter_price:
            if req.min_price > 0: cond_price = cond_price and (price >= req.min_price)
            if req.max_price > 0: cond_price = cond_price and (price <= req.max_price)

        cond_volume = True
        if req.filter_volume:
            if req.min_volume_m > 0: cond_volume = cond_volume and (vol_m >= req.min_volume_m)
            if req.max_volume_m > 0: cond_volume = cond_volume and (vol_m <= req.max_volume_m)

        is_passed = cond_gap and cond_gainer and cond_intraday and cond_interval and cond_mc and cond_float and cond_price and cond_volume

        if req.strict_filter and not is_passed:
            continue

        results.append({
            "Ticker": ticker,
            "Price": round(price, 2),
            "Gap (%)": round(gap_pct, 2),
            "Gainer (%)": round(changes_pct, 2),
            "開盤到目前漲幅 (%)": round(intraday_pct, 2),
            f"最近{req.recent_mins_window}分鐘最大漲幅 (%)": round(recent_pct, 2),
            "Volume": q.get("volume", 0),
            "Market Cap (M)": round(mc_m, 2) if mc_m > 0 else None,
            "Float (M)": round(float_m, 2) if float_m > 0 else None,
            "達標 Signal": "✅" if is_passed else "❌",
            "_is_passed": is_passed,
            "_recent_pct": recent_pct
        })

    # 4.5 Process custom_tickers results
    custom_results = []
    for ticker in req.custom_tickers:
        q = quotes_dict.get(ticker, {})
        price = q.get("price", 0)
        open_price = q.get("open", 0)
        prev_close = q.get("previousClose", 0)
        changes_pct = q.get("changePercentage", 0)
        market_cap = q.get("marketCap", 0)

        gap_pct = ((open_price / prev_close - 1) * 100) if prev_close and prev_close > 0 else 0
        intraday_pct = ((price / open_price - 1) * 100) if open_price and open_price > 0 else 0
        mc_m = market_cap / 1e6 if market_cap else 0

        float_shares = GLOBAL_FLOATS_CACHE.get(ticker, 0)
        float_m = float_shares / 1e6 if float_shares else 0

        # Calculate recent N-minute max gain from ring buffer
        cutoff = ts - window_secs
        buf = PRICE_BUFFER.get(ticker, deque())
        prices_in_window = [p for t, p in buf if t >= cutoff and p > 0]

        if prices_in_window and price and price > 0:
            min_price = min(prices_in_window)
            recent_pct = ((price / min_price) - 1) * 100
        else:
            recent_pct = 0.0

        custom_results.append({
            "Ticker": ticker,
            "Price": round(price, 2),
            "Gap (%)": round(gap_pct, 2),
            "Gainer (%)": round(changes_pct, 2),
            "開盤到目前漲幅 (%)": round(intraday_pct, 2),
            f"最近{req.recent_mins_window}分鐘最大漲幅 (%)": round(recent_pct, 2),
            "Volume": q.get("volume", 0),
            "Market Cap (M)": round(mc_m, 2) if mc_m > 0 else None,
            "Float (M)": round(float_m, 2) if float_m > 0 else None,
        })

    # 5. Unified Watchlist Updates
    now_dt = datetime.datetime.now()
    watchlist = req.watchlist.copy()
    new_notifications = []
    expiry_secs = req.watchlist_expiry_mins * 60

    # Step 5a: Add newly triggered items from the current screener results
    for r in results:
        ticker = r["Ticker"]
        if r["_is_passed"] and ticker not in watchlist:
            watchlist[ticker] = {
                "trigger_time": now_dt.isoformat(),
                "trigger_price": r["Price"],
                "trigger_pct": r["_recent_pct"],
                "max_price_since_trigger": r["Price"]
            }
            new_notifications.append(ticker)

    # Step 5b: Single pass to update max price, inject real-time stats, and remove expired entries
    for ticker in list(watchlist.keys()):
        info = watchlist[ticker]
        
        # 1. Remove expired entries
        if (now_dt - datetime.datetime.fromisoformat(info["trigger_time"])).total_seconds() > expiry_secs:
            watchlist.pop(ticker, None)
            continue
            
        # 2. Get latest quote for this ticker
        q = quotes_dict.get(ticker, {})
        price = q.get("price", 0)
        
        # 3. Update max price
        if price > 0:
            watchlist[ticker]["max_price_since_trigger"] = max(
                watchlist[ticker]["max_price_since_trigger"], price
            )
            
        # 4. Inject real-time stats for frontend rendering
        open_price = q.get("open", 0)
        market_cap = q.get("marketCap", 0)
        volume = q.get("volume", 0)
        
        watchlist[ticker]["current_price"] = price
        watchlist[ticker]["current_gainer"] = q.get("changePercentage", 0)
        watchlist[ticker]["current_intraday"] = ((price / open_price - 1) * 100) if open_price and open_price > 0 else 0
        watchlist[ticker]["volume"] = volume
        watchlist[ticker]["mc_m"] = market_cap / 1e6 if market_cap else 0
        
        float_shares = GLOBAL_FLOATS_CACHE.get(ticker, 0)
        watchlist[ticker]["float_m"] = float_shares / 1e6 if float_shares else 0

    # Strip internal fields from results
    for r in results:
        r.pop("_is_passed", None)
        r.pop("_recent_pct", None)

    return sanitize_value({
        "results": results,
        "custom_results": custom_results,
        "watchlist": watchlist,
        "new_notifications": new_notifications,
        "gainers_refreshed_at": GAINERS_CACHE["updated_at"].isoformat() if GAINERS_CACHE.get("updated_at") else None,
        "buffer_sample_count": {t: len(PRICE_BUFFER[t]) for t in gainers_tickers if t in PRICE_BUFFER}
    })


@app.post("/api/screener/realtime")
def post_screener_realtime(req: RealtimeScreenerRequest):
    key = req.fmp_api_key or os.environ.get("FMP_API_KEY", "")
    if not key:
        raise HTTPException(status_code=400, detail="FMP API Key is required for Real-time Screener.")

    global SCREENER_CACHE, LAST_SCREENER_REQUEST
    LAST_SCREENER_REQUEST = req
    
    # Construct config key to check if query criteria has changed
    cache_key = f"{req.intraday_interval}_{req.today_only}_{req.extended_hours}_{req.auto_refresh_mins}_{req.recent_mins_window}"
    
    # Check if cache is fresh (e.g. less than 45 seconds old) and matches cache_key
    cache_updated_at = SCREENER_CACHE.get("updated_at")
    cache_age = (datetime.datetime.now() - cache_updated_at).total_seconds() if cache_updated_at else 99999.0
    
    use_cache = (
        (req.lightweight or cache_age < 45) 
        and SCREENER_CACHE["cache_key"] == cache_key 
        and len(SCREENER_CACHE["gainers"]) > 0
    )

    session = get_market_session_status()

    if use_cache:
        # Lightweight path: reuse cached metadata and only fetch latest quotes
        gainers = SCREENER_CACHE["gainers"]
        tickers = [item['symbol'] for item in gainers if 'symbol' in item]
        quotes = get_realtime_quotes(key, tickers)
        floats_dict = SCREENER_CACHE["floats"]
        closes_data = SCREENER_CACHE["closes"]
        
        # Resolve interval
        resolved_interval = resolve_interval(req.intraday_interval, req.recent_mins_window)
    else:
        # Full path: fetch everything from scratch
        gainers = get_realtime_biggest_gainers(key)
        if not gainers:
            return sanitize_value({"results": [], "watchlist": req.watchlist, "new_notifications": []})

        tickers = [item['symbol'] for item in gainers if 'symbol' in item]
        
        # Resolve interval
        resolved_interval = resolve_interval(req.intraday_interval, req.recent_mins_window)

        from_date = pd.Timestamp.now('US/Eastern').strftime('%Y-%m-%d') if req.today_only else ""

        max_closes = max(10, req.recent_mins_window) if resolved_interval == "1min" else max(10, (req.recent_mins_window + 4) // 5)

        # Concurrent execution of quotes, floats (optimized), and closes
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_quotes = executor.submit(get_realtime_quotes, key, tickers)
            future_floats = executor.submit(get_floats_optimized, key, tickers)
            if resolved_interval == "1min":
                future_closes = executor.submit(get_realtime_1min_closes, key, tickers, from_date, req.extended_hours, max_closes)
            else:
                future_closes = executor.submit(get_realtime_5min_closes, key, tickers, from_date, req.extended_hours, max_closes)

            quotes = future_quotes.result()
            floats_dict = future_floats.result()
            closes_data = future_closes.result()

        # Save to global cache
        SCREENER_CACHE["cache_key"] = cache_key
        SCREENER_CACHE["gainers"] = gainers
        SCREENER_CACHE["floats"] = floats_dict
        SCREENER_CACHE["closes"] = closes_data
        SCREENER_CACHE["updated_at"] = datetime.datetime.now()

    quotes_dict = {q['symbol']: q for q in quotes if 'symbol' in q}

    # 3. Calculate metrics & filter
    results = []
    max_closes = max(10, req.recent_mins_window) if resolved_interval == "1min" else max(10, (req.recent_mins_window + 4) // 5)
    candle_count = min(req.recent_mins_window, max_closes) if resolved_interval == "1min" else min(max(1, req.recent_mins_window // 5), max_closes)

    for ticker in tickers:
        quote = quotes_dict.get(ticker, {})
        price = quote.get('price', 0)
        open_price = quote.get('open', 0)
        prev_close = quote.get('previousClose', 0)
        changes_pct = quote.get('changePercentage', 0)
        market_cap = quote.get('marketCap', 0)

        gap_pct = ((open_price / prev_close - 1) * 100) if prev_close and prev_close > 0 else 0
        intraday_pct = ((price / open_price - 1) * 100) if open_price and open_price > 0 else 0
        mc_m = market_cap / 1e6 if market_cap else 0

        float_shares = floats_dict.get(ticker, 0)
        float_m = float_shares / 1e6 if float_shares else 0

        prev_candles = closes_data.get(ticker, [])
        # Reverse from newest-first to oldest-first (chronological) for sliding window
        prev_candles = prev_candles[::-1]
        
        # Calculate dynamic window returns
        # Each candle is {"open": ..., "close": ...}
        # max gain = (current_price - min_entry) / min_entry * 100
        # where min_entry = min of all opens and closes across the window
        if session == "regular":
            completed_count = candle_count
            window_candles = prev_candles[-completed_count:]
            # Collect all open and close prices in window + live price as the exit
            all_prices = [c["open"] for c in window_candles] + [c["close"] for c in window_candles] + [price]
        else:
            window_size = max(2, candle_count)
            window_candles = prev_candles[-window_size:]
            if window_candles:
                price = window_candles[-1]["close"]
            all_prices = [c["open"] for c in window_candles] + [c["close"] for c in window_candles]

        if all_prices:
            min_entry = min(p for p in all_prices if p > 0) if any(p > 0 for p in all_prices) else 0
            recent_candle_pct = ((price / min_entry - 1) * 100) if min_entry > 0 else 0.0
        else:
            recent_candle_pct = 0.0


        # Filter criteria
        cond_gap = (gap_pct >= req.min_gap) if req.filter_gap else True
        cond_gainer = (changes_pct >= req.min_gainer) if req.filter_gainer else True
        cond_intraday = (intraday_pct >= req.min_intraday) if req.filter_intraday else True
        cond_5min = (recent_candle_pct >= req.min_interval_pct) if req.filter_interval else True

        cond_mc = True
        if req.filter_mc:
            if req.min_mc_m > 0: cond_mc = cond_mc and (mc_m >= req.min_mc_m)
            if req.max_mc_m > 0: cond_mc = cond_mc and (mc_m <= req.max_mc_m)

        cond_float = True
        if req.filter_float:
            if req.min_float_m > 0: cond_float = cond_float and (float_m >= req.min_float_m)
            if req.max_float_m > 0: cond_float = cond_float and (float_m <= req.max_float_m)

        cond_price = True
        if req.filter_price:
            if req.min_price > 0: cond_price = cond_price and (price >= req.min_price)
            if req.max_price > 0: cond_price = cond_price and (price <= req.max_price)

        is_passed = cond_gap and cond_gainer and cond_intraday and cond_5min and cond_mc and cond_float and cond_price

        if req.strict_filter and not is_passed:
            continue

        results.append({
            "Ticker": ticker,
            "Price": round(price, 2),
            "Gap (%)": round(gap_pct, 2),
            "Gainer (%)": round(changes_pct, 2),
            "開盤到目前漲幅 (%)": round(intraday_pct, 2),
            f"最近{req.recent_mins_window}分鐘最大漲幅 (%)": round(recent_candle_pct, 2),
            "Market Cap (M)": round(mc_m, 2) if mc_m > 0 else None,
            "Float (M)": round(float_m, 2) if float_m > 0 else None,
            "達標 Signal": "✅" if is_passed else "❌",
            "_is_passed": is_passed,
            "_recent_candle_pct": recent_candle_pct
        })

    # 4. Watchlist Updates & Expirations (Stateless)
    now = datetime.datetime.now()
    watchlist = req.watchlist.copy()

    new_notifications = []
    
    for r in results:
        ticker = r["Ticker"]
        price = r["Price"]
        if r["_is_passed"]:
            if ticker not in watchlist:
                watchlist[ticker] = {
                    "trigger_time": now.isoformat(),
                    "trigger_price": price,
                    "trigger_pct": r["_recent_candle_pct"],
                    "max_price_since_trigger": price
                }
                new_notifications.append(ticker)
            else:
                watchlist[ticker]["max_price_since_trigger"] = max(
                    watchlist[ticker]["max_price_since_trigger"],
                    price
                )
        elif ticker in watchlist:
            watchlist[ticker]["max_price_since_trigger"] = max(
                watchlist[ticker]["max_price_since_trigger"],
                price
            )

    # Delete expired watchlist tickers
    expired_tickers = []
    expiry_secs = req.watchlist_expiry_mins * 60
    for ticker, info in watchlist.items():
        trig_time = datetime.datetime.fromisoformat(info["trigger_time"])
        if (now - trig_time).total_seconds() > expiry_secs:
            expired_tickers.append(ticker)

    for ticker in expired_tickers:
        watchlist.pop(ticker, None)

    # Remove internal tracking variables
    for r in results:
        r.pop("_is_passed", None)
        r.pop("_recent_candle_pct", None)

    return sanitize_value({
        "results": results,
        "watchlist": watchlist,
        "new_notifications": new_notifications,
        "prewarm_execution_time": PREWARM_EXECUTION_TIME,
        "prewarmed": use_cache and (req.lightweight is False or cache_age < 45)
    })

@app.post("/api/backtest/vectorized")
def post_backtest_vectorized(req: VectorizedBacktestRequest):
    key = req.fmp_api_key or os.environ.get("FMP_API_KEY", "")
    if req.data_source == "FMP" and not key:
        raise HTTPException(status_code=400, detail="FMP API Key is required.")

    all_dfs = {}
    for t in req.tickers:
        df = RAW_DATA_CACHE.get(t)
        if df is None or len(df) < 200:
            df = get_historical_data(t, req.data_source, req.period, key)
            if not df.empty:
                RAW_DATA_CACHE[t] = df
        
        if df is not None and not df.empty:
            all_dfs[t] = df

    if not all_dfs:
        raise HTTPException(status_code=404, detail="No historical data found for backtest tickers.")

    trade_logs = []
    portfolio_daily = pd.DataFrame()
    portfolio_bnh = pd.DataFrame()
    total_actual_trades = 0
    win_trades_sum = 0

    for t_name, orig_df in all_dfs.items():
        bt_df = orig_df.copy()
        
        # Strategy conditions
        if "極端" in req.strategy_choice:
            bt_df['Prev_Close'] = bt_df['Close'].shift(1)
            bt_df['Prev_Prev_Close'] = bt_df['Close'].shift(2)
            bt_df['Prev_Open'] = bt_df['Open'].shift(1)
            
            bt_df['Cond1_Val'] = (bt_df['Prev_Close'] / bt_df['Prev_Prev_Close'] - 1) * 100
            bt_df['Cond2_Val'] = (bt_df['Prev_Close'] / bt_df['Prev_Open'] - 1) * 100
            bt_df['Cond3_Val'] = bt_df['Open'] <= bt_df['Prev_Close']
            
            bt_df['Signal'] = np.where(
                (bt_df['Cond1_Val'] >= req.cond1_pct) & 
                (bt_df['Cond2_Val'] >= req.cond2_pct) & 
                bt_df['Cond3_Val'], 
                1, 0
            )
            
            tp_flag = (bt_df['Low'] <= bt_df['Open'] * (1 - req.tp_pct / 100.0)) if req.tp_pct > 0 else False
            sl_flag = (bt_df['High'] >= bt_df['Open'] * (1 + req.sl_pct / 100.0)) if req.sl_pct > 0 else False
            
            bt_df['Hit_TP'] = tp_flag
            bt_df['Hit_SL'] = sl_flag
            
            def calc_intraday_return(row):
                if row['Signal'] == 0:
                    return 0.0
                ret_tp = req.tp_pct / 100.0
                ret_sl = -req.sl_pct / 100.0
                ret_close = (row['Open'] - row['Close']) / row['Open']
                
                if row.get('Hit_TP', False) and row.get('Hit_SL', False):
                    return ret_sl
                elif row.get('Hit_TP', False):
                    return ret_tp
                elif row.get('Hit_SL', False):
                    return ret_sl
                else:
                    return ret_close
                    
            bt_df['Daily_Trade_Return'] = bt_df.apply(calc_intraday_return, axis=1)
        
        else:
            # Dual SMA
            bt_df['Fast_SMA'] = bt_df['Close'].rolling(window=req.sma_fast).mean()
            bt_df['Slow_SMA'] = bt_df['Close'].rolling(window=req.sma_slow).mean()
            
            bt_df['Signal'] = np.where(bt_df['Fast_SMA'] > bt_df['Slow_SMA'], 1, 0)
            bt_df['Daily_Return'] = bt_df['Close'].pct_change()
            
            bt_df['Daily_Trade_Return'] = bt_df['Signal'].shift(1) * bt_df['Daily_Return']
            bt_df['Daily_Trade_Return'] = bt_df['Daily_Trade_Return'].fillna(0)

        bt_df['BnH_Return'] = bt_df['Close'].pct_change()

        if portfolio_daily.empty:
            portfolio_daily = pd.DataFrame(index=bt_df.index)
            portfolio_bnh = pd.DataFrame(index=bt_df.index)
            
        portfolio_daily[t_name] = bt_df['Daily_Trade_Return']
        portfolio_bnh[t_name] = bt_df['BnH_Return']
        
        total_trades = bt_df['Signal'].sum()
        if total_trades > 0:
            win_trades_sum += (bt_df['Daily_Trade_Return'] > 0).sum()
            total_actual_trades += total_trades
            
            if "極端" in req.strategy_choice:
                details = bt_df[bt_df['Signal'] == 1][['Open', 'Close', 'Cond1_Val', 'Cond2_Val', 'Hit_TP', 'Hit_SL', 'Daily_Trade_Return']].copy()
                details.insert(0, '標的', t_name)
                details['出場備註'] = np.select(
                    [details['Hit_TP'] & details['Hit_SL'], details['Hit_TP'], details['Hit_SL']],
                    ['觸及止損 (雙觸保本保守估計)', '觸及止盈', '觸及止損'],
                    default='收盤回補'
                )
                details = details[['標的', 'Open', 'Close', 'Cond1_Val', 'Cond2_Val', '出場備註', 'Daily_Trade_Return']]
                details.columns = ['標的', '開盤空點', '收盤價', '前日單日總漲幅(%)', '前日K棒實體漲幅(%)', '出場動作狀態', '當沖獲利(%)']
                details['當沖獲利(%)'] = details['當沖獲利(%)'] * 100
                details = details.reset_index()
                details['date'] = details['date'].dt.strftime('%Y-%m-%d')
                trade_logs.append(details)
            else:
                bt_df['Position_Change'] = bt_df['Signal'].diff()
                trade_events = bt_df[bt_df['Position_Change'] != 0].copy()
                trade_events = trade_events.dropna(subset=['Position_Change'])
                details = trade_events[['Close', 'Fast_SMA', 'Slow_SMA', 'Position_Change']].copy()
                details.insert(0, '標的', t_name)
                details['動作'] = np.where(details['Position_Change'] == 1, "↗️ 做多 (Buy)", "↘️ 空倉 (Sell)")
                details = details.drop(columns=['Position_Change'])
                details.columns = ['標的', '觸發價(Close)', '快線', '慢線', '明日部位動作']
                details = details.reset_index()
                details['date'] = details['date'].dt.strftime('%Y-%m-%d')
                trade_logs.append(details)

    if total_actual_trades == 0:
        return sanitize_value({
            "metrics": {
                "final_value": 0, "total_return_pct": 0, "mdd_pct": 0, "total_trades": 0, "win_rate": 0, "sharpe": 0
            },
            "equity": [],
            "logs": []
        })

    portfolio_daily.fillna(0, inplace=True)
    portfolio_bnh.fillna(0, inplace=True)

    if len(req.tickers) > 1:
        agg_daily = portfolio_daily.mean(axis=1)
        agg_bnh = portfolio_bnh.mean(axis=1)
    else:
        agg_daily = portfolio_daily.iloc[:, 0]
        agg_bnh = portfolio_bnh.iloc[:, 0]

    cum_ret = (1 + agg_daily).cumprod() - 1
    bnh_cum = (1 + agg_bnh).cumprod() - 1

    win_rate = (win_trades_sum / total_actual_trades) * 100
    total_ret = cum_ret.iloc[-1] * 100

    running_max = (1 + cum_ret).cummax()
    drawdown = (1 + cum_ret) / running_max - 1
    mdd = drawdown.min() * 100

    active_returns = agg_daily[agg_daily != 0]
    sharpe = (active_returns.mean() / active_returns.std() * np.sqrt(252)) if len(active_returns) > 1 and active_returns.std() > 0 else 0

    # Format equity data for line charts
    equity_chart_data = []
    for date, ret in cum_ret.items():
        equity_chart_data.append({
            "time": date.strftime('%Y-%m-%d'),
            "strategy": round(float(ret * 100), 2),
            "bnh": round(float(bnh_cum.loc[date] * 100), 2)
        })

    # Concatenate trade logs
    flat_logs = []
    if trade_logs:
        all_logs_df = pd.concat(trade_logs).sort_values(by="date").reset_index(drop=True)
        flat_logs = all_logs_df.to_dict(orient="records")

    return sanitize_value({
        "metrics": {
            "total_return_pct": round(float(total_ret), 2),
            "mdd_pct": round(float(mdd), 2),
            "total_trades": int(total_actual_trades),
            "win_rate": round(float(win_rate), 2),
            "sharpe": round(float(sharpe), 2)
        },
        "equity": equity_chart_data,
        "logs": flat_logs
    })

@app.post("/api/backtest/backtrader")
def post_backtest_backtrader(req: BacktraderRequest):
    key = req.fmp_api_key or os.environ.get("FMP_API_KEY", "")
    if req.data_source == "FMP" and not key:
        raise HTTPException(status_code=400, detail="FMP API Key is required.")

    # Convert frontend strategy key to parameter input
    strategy_mapping = {
        "A. 雙均線波段做多 (含動態止盈止損)": "dual_sma",
        "B. 極端暴漲當沖放空 (嚴格隔日收盤回補)": "momentum_short",
        "C. 暴漲隔日 5min 限價放空 (Precision 5min Backtest)": "5min_short"
    }

    strategy_type = strategy_mapping.get(req.strategy, "dual_sma")

    # Fetch daily DataFrames for all selected tickers
    target_dfs = {}
    for t in req.tickers:
        df = RAW_DATA_CACHE.get(t)
        if df is None or len(df) < 21:
            df = get_historical_data(t, req.data_source, req.period, key)
            if not df.empty:
                RAW_DATA_CACHE[t] = df
        
        if df is not None and not df.empty:
            target_dfs[t] = df

    if not target_dfs:
        raise HTTPException(status_code=404, detail="No historical price feeds found.")

    algo_params = {
        "strategy": strategy_type,
        "stake_mode": req.stake_mode,
        "stake_val": req.stake_val,
        "tp_pct": req.tp_pct,
        "sl_pct": req.sl_pct,
        "sma_fast": req.sma_fast,
        "sma_slow": req.sma_slow,
        "cond1_pct": req.cond1_pct,
        "cond2_pct": req.cond2_pct,
        "max_hold": req.max_hold
    }

    params_dict = {
        "starting_cash": req.starting_cash,
        "commission_val": req.commission_val,
        "is_fixed_comm": req.is_fixed_comm,
        **algo_params
    }

    try:
        if strategy_type == "5min_short":
            # 5min Intraday OCO Backtest
            # Step 1: Detect trigger days based on Daily K-line
            trigger_events = []
            for t_name, tgt_df in target_dfs.items():
                if tgt_df is None or len(tgt_df) < 21:
                    continue
                tmp = tgt_df.copy()
                tmp['_prev_close'] = tmp['Close'].shift(1)
                tmp['_prev_prev_close'] = tmp['Close'].shift(2)
                tmp['_prev_open'] = tmp['Open'].shift(1)
                tmp['_vol_T'] = tmp['Volume'].shift(1)
                tmp['_vol_ma20'] = tmp['Volume'].shift(1).rolling(20).mean()
                tmp['_rvol'] = tmp['_vol_T'] / tmp['_vol_ma20']

                tmp['_ret'] = (tmp['_prev_close'] / tmp['_prev_prev_close'] - 1) * 100
                tmp['_body'] = (tmp['_prev_close'] / tmp['_prev_open'] - 1) * 100
                tmp['_gap_ok'] = tmp['Open'] <= tmp['_prev_close']
                
                hits = tmp[
                    (tmp['_ret'] >= req.cond1_pct) &
                    (tmp['_body'] >= req.cond2_pct) &
                    (tmp['_rvol'] >= 10.0) &
                    tmp['_gap_ok']
                ]
                
                for entry_date, row in hits.iterrows():
                    trigger_dates = tmp.index[tmp.index < entry_date]
                    if len(trigger_dates) > 0:
                        trigger_date = trigger_dates[-1]
                        trigger_events.append((t_name, trigger_date, entry_date, row['_prev_close']))
            
            if not trigger_events:
                return sanitize_value({
                    "metrics": {"final_value": req.starting_cash, "total_return_pct": 0, "mdd_pct": 0, "total_trades": 0, "win_rate": 0, "sharpe": 0},
                    "equity": [],
                    "logs": [],
                    "warning": "No 5min trigger events found matching conditions."
                })

            # Step 2: Download 5-minute ticks for trigger and entry days
            dfs_5min = {}
            for ev in trigger_events:
                t_name, trigger_date, entry_date, prev_close = ev
                from_str = trigger_date.strftime('%Y-%m-%d')
                to_str = entry_date.strftime('%Y-%m-%d')
                feed_key = f"{t_name}_{to_str}"
                
                df_5m = get_intraday_data(t_name, "5min", from_str, to_str, key)
                if df_5m is not None and not df_5m.empty:
                    df_5m['prev_close'] = prev_close
                    dfs_5min[feed_key] = df_5m

            if not dfs_5min:
                raise HTTPException(status_code=400, detail="Failed to fetch 5min data for matched events.")

            metrics, equity_df, trade_logs_df = run_backtrader_5min(dfs_5min, params_dict)
        else:
            # Daily Daily Backtest
            metrics, equity_df, trade_logs_df = run_backtrader(target_dfs, params_dict)

        # Format equity data for line charts
        equity_chart_data = []
        for date, row in equity_df.iterrows():
            time_str = date.strftime('%Y-%m-%d') if isinstance(date, (pd.Timestamp, datetime.date)) else str(date)
            equity_chart_data.append({
                "time": time_str,
                "strategy": round(float(row['Cumulative_Return'] * 100), 2)
            })

        # Format trade logs
        logs = []
        if not trade_logs_df.empty:
            logs = trade_logs_df.to_dict(orient="records")

        return sanitize_value({
            "metrics": {
                "final_value": round(float(metrics["final_value"]), 2),
                "total_return_pct": round(float(metrics["total_return_pct"]), 2),
                "mdd_pct": round(float(metrics["mdd_pct"]), 2),
                "total_trades": int(metrics["total_trades"]),
                "win_rate": round(float(metrics["win_rate"]), 2),
                "sharpe": round(float(metrics["sharpe"]), 2)
            },
            "equity": equity_chart_data,
            "logs": logs
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
