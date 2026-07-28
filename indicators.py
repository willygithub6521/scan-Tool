import pandas as pd
import numpy as np

def add_sma(df: pd.DataFrame, window: int = 50) -> pd.DataFrame:
    """Calculate Simple Moving Average."""
    df[f'SMA_{window}'] = df['Close'].rolling(window=window).mean()
    return df

def add_ema(df: pd.DataFrame, window: int = 20) -> pd.DataFrame:
    """Calculate Exponential Moving Average."""
    df[f'EMA_{window}'] = df['Close'].ewm(span=window, adjust=False).mean()
    return df

def add_rsi(df: pd.DataFrame, window: int = 14) -> pd.DataFrame:
    """Calculate Relative Strength Index."""
    delta = df['Close'].diff()
    # Replace negative deltas with 0 for gain, replace positive deltas with 0 for loss
    gain = delta.where(delta > 0, 0).rolling(window=window).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()
    
    rs = gain / loss
    df[f'RSI_{window}'] = 100 - (100 / (1 + rs))
    return df

def add_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    """Calculate MACD."""
    ema_fast = df['Close'].ewm(span=fast, adjust=False).mean()
    ema_slow = df['Close'].ewm(span=slow, adjust=False).mean()
    df['MACD'] = ema_fast - ema_slow
    df['MACD_Signal'] = df['MACD'].ewm(span=signal, adjust=False).mean()
    df['MACD_Hist'] = df['MACD'] - df['MACD_Signal']
    return df

def add_bollinger_bands(df: pd.DataFrame, window: int = 20, num_std: int = 2) -> pd.DataFrame:
    """Calculate Bollinger Bands."""
    df[f'BB_Mid_{window}'] = df['Close'].rolling(window=window).mean()
    std = df['Close'].rolling(window=window).std()
    df[f'BB_Upper_{window}'] = df[f'BB_Mid_{window}'] + (std * num_std)
    df[f'BB_Lower_{window}'] = df[f'BB_Mid_{window}'] - (std * num_std)
    # 壓縮頻寬指標 (Bollinger Band Width)
    df[f'BB_Width_{window}'] = (df[f'BB_Upper_{window}'] - df[f'BB_Lower_{window}']) / df[f'BB_Mid_{window}']
    return df

def add_atr(df: pd.DataFrame, window: int = 14) -> pd.DataFrame:
    """Calculate Average True Range (ATR)."""
    high_low = df['High'] - df['Low']
    high_close = (df['High'] - df['Close'].shift()).abs()
    low_close = (df['Low'] - df['Close'].shift()).abs()
    ranges = pd.concat([high_low, high_close, low_close], axis=1)
    true_range = ranges.max(axis=1)
    df[f'ATR_{window}'] = true_range.rolling(window=window).mean()
    return df

def calculate_compression_factor(df: pd.DataFrame, window: int = 60) -> float:
    """Calculate Price Compression Factor over Lookback Window N using ATR Ratio."""
    try:
        if len(df) < 15:
            return 1.0  # fallback if insufficient data for ATR
        
        # Ensure ATR_14 exists or calculate it
        if 'ATR_14' not in df.columns:
            high_low = df['High'] - df['Low']
            high_close = (df['High'] - df['Close'].shift()).abs()
            low_close = (df['Low'] - df['Close'].shift()).abs()
            ranges = pd.concat([high_low, high_close, low_close], axis=1)
            true_range = ranges.max(axis=1)
            atr = true_range.rolling(window=14).mean()
        else:
            atr = df['ATR_14']
            
        atr_ratio = atr / df['Close'].replace(0, np.nan)
        sma_atr_ratio = atr_ratio.rolling(window=min(window, len(df))).mean()
        
        latest_ratio = atr_ratio.iloc[-1]
        latest_sma = sma_atr_ratio.iloc[-1]
        
        if pd.isna(latest_ratio) or pd.isna(latest_sma) or latest_sma == 0:
            return 1.0
            
        return float(latest_ratio / latest_sma)
    except Exception:
        return 1.0

def calculate_ad_divergence(df: pd.DataFrame, window: int = 60) -> tuple:
    """
    Calculate Volume Accumulation (A/D Line Trend Divergence over N bars).
    Returns (slope_close, slope_ad, is_divergence).
    """
    try:
        n = min(window, len(df))
        if n < 3:
            return (0.0, 0.0, False)
            
        sub_df = df.tail(n).copy()
        
        # CLV_t = [(2*Close - High - Low) / (High - Low)]
        high_low = sub_df['High'] - sub_df['Low']
        # Replace 0 range with 1.0 to avoid zero division; CLV becomes 0 when High == Low
        range_divisor = np.where(high_low == 0, 1.0, high_low)
        clv = ((2 * sub_df['Close'] - sub_df['High'] - sub_df['Low']) / range_divisor)
        clv = np.where(high_low == 0, 0.0, clv)
        
        ad_line = (clv * sub_df['Volume']).cumsum()
        
        x = np.arange(n)
        slope_close, _ = np.polyfit(x, sub_df['Close'].values, 1)
        slope_ad, _ = np.polyfit(x, ad_line, 1)
        
        is_divergence = (slope_close <= 0.0) and (slope_ad > 0.0)
        return (float(slope_close), float(slope_ad), bool(is_divergence))
    except Exception:
        return (0.0, 0.0, False)

def calculate_volume_profile(df: pd.DataFrame, window: int = 60, bins: int = 50) -> dict:
    """
    Construct N-bar Volume Profile histogram with 50 price bins.
    Returns dict containing POC price, Top 3 Volume concentration percentage, and proximity check.
    """
    try:
        n = min(window, len(df))
        if n < 1:
            return {"poc": 0.0, "top_3_vol_pct": 0.0, "near_poc": False, "passed": False}
            
        sub_df = df.tail(n)
        p_min = float(sub_df['Low'].min())
        p_max = float(sub_df['High'].max())
        
        if p_max <= p_min or np.isclose(p_max, p_min):
            poc_val = p_min
            return {"poc": round(poc_val, 2), "top_3_vol_pct": 100.0, "near_poc": True, "passed": True}
            
        bin_edges = np.linspace(p_min, p_max, bins + 1)
        bin_volumes = np.zeros(bins)
        
        # For each bar, distribute volume across bins covered by [Low, High]
        lows = sub_df['Low'].values
        highs = sub_df['High'].values
        vols = sub_df['Volume'].values
        
        for idx in range(len(sub_df)):
            l = lows[idx]
            h = highs[idx]
            v = vols[idx]
            
            if h <= l or np.isclose(h, l):
                b_idx = min(bins - 1, max(0, int((l - p_min) / (p_max - p_min) * bins)))
                bin_volumes[b_idx] += v
            else:
                bin_lows = bin_edges[:-1]
                bin_highs = bin_edges[1:]
                overlap_low = np.maximum(l, bin_lows)
                overlap_high = np.minimum(h, bin_highs)
                overlap = np.maximum(0.0, overlap_high - overlap_low)
                total_overlap = np.sum(overlap)
                if total_overlap > 0:
                    bin_volumes += (overlap / total_overlap) * v
                else:
                    b_idx = min(bins - 1, max(0, int((l - p_min) / (p_max - p_min) * bins)))
                    bin_volumes[b_idx] += v
                    
        total_vol = np.sum(bin_volumes)
        if total_vol == 0:
            return {"poc": round((p_max + p_min) / 2, 2), "top_3_vol_pct": 0.0, "near_poc": False, "passed": False}
            
        # Point of Control (POC) is midpoint of bin with maximum volume
        max_bin_idx = np.argmax(bin_volumes)
        poc = float((bin_edges[max_bin_idx] + bin_edges[max_bin_idx + 1]) / 2.0)
        
        # High Volume Nodes (HVN): Top 3 volume bins
        sorted_vols = np.sort(bin_volumes)
        top_3_vol = np.sum(sorted_vols[-3:])
        top_3_pct = float(top_3_vol / total_vol * 100.0)
        
        current_price = float(sub_df['Close'].iloc[-1])
        near_poc = bool(abs(current_price - poc) / poc <= 0.05) if poc > 0 else False
        
        passed = bool(near_poc and top_3_pct >= 35.0)
        return {
            "poc": round(poc, 2),
            "top_3_vol_pct": round(top_3_pct, 1),
            "near_poc": near_poc,
            "passed": passed
        }
    except Exception:
        return {"poc": 0.0, "top_3_vol_pct": 0.0, "near_poc": False, "passed": False}

