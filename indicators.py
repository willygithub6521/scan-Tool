import pandas as pd

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
