import yfinance as yf
import pandas as pd
import requests
from abc import ABC, abstractmethod
import functools

def log_error(msg: str):
    try:
        from streamlit.runtime import exists as st_exists
        if st_exists():
            import streamlit as st
            st.error(msg)
            return
    except Exception:
        pass
    print(f"[ERROR] {msg}", flush=True)

def safe_cache_data(ttl=None, show_spinner=False):
    try:
        from streamlit.runtime import exists as st_exists
        if st_exists():
            import streamlit as st
            return st.cache_data(ttl=ttl, show_spinner=show_spinner)
    except Exception:
        pass
        
    def decorator(func):
        cache = {}
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            def make_hashable(val):
                if isinstance(val, dict):
                    return tuple(sorted((k, make_hashable(v)) for k, v in val.items()))
                elif isinstance(val, list):
                    return tuple(make_hashable(v) for v in val)
                elif isinstance(val, set):
                    return tuple(sorted(make_hashable(v) for v in val))
                return val
            
            hashable_args = tuple(make_hashable(arg) for arg in args)
            hashable_kwargs = tuple(sorted((k, make_hashable(v)) for k, v in kwargs.items()))
            key = (hashable_args, hashable_kwargs)
            if key in cache:
                return cache[key]
            result = func(*args, **kwargs)
            cache[key] = result
            return result
        return wrapper
    return decorator

class DataProvider(ABC):
    @abstractmethod
    def fetch_historical_data(self, ticker: str, period: str) -> pd.DataFrame:
        pass
        
    @abstractmethod
    def fetch_basic_info(self, ticker: str) -> dict:
        pass

class YFinanceProvider(DataProvider):
    def fetch_historical_data(self, ticker: str, period: str = "1y") -> pd.DataFrame:
        try:
            stock = yf.Ticker(ticker)
            # Yfinance interval '1d' by default
            df = stock.history(period=period, interval="1d")
            if df is None or df.empty:
                return pd.DataFrame()
            # Ensure naive dates
            if isinstance(df.index, pd.DatetimeIndex) and df.index.tz is not None:
                df.index = df.index.tz_localize(None)
            return df
        except Exception as e:
            log_error(f"Error fetching data from YFinance for {ticker}: {e}")
            return pd.DataFrame()

    def fetch_basic_info(self, ticker: str) -> dict:
        try:
            stock = yf.Ticker(ticker)
            return stock.info
        except Exception:
            return {}

class FMPProvider(DataProvider):
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://financialmodelingprep.com/stable"

    def fetch_historical_data(self, ticker: str, period: str = "1y") -> pd.DataFrame:
        # Map Streamlit periods to FMP timeseries lengths (rough approximate trading days)
        days_map = {"1mo": 22, "3mo": 66, "6mo": 130, "1y": 252, "2y": 504, "5y": 1260, "max": 5000}
        timeseries = days_map.get(period, 252)

        url = f"{self.base_url}/historical-price-eod/full?symbol={ticker}&apikey={self.api_key}" #&timeseries={timeseries}
        try:
            response = requests.get(url)
            data = response.json()
            
            if isinstance(data, dict) and "historical" in data:
                df = pd.DataFrame(data["historical"])
            elif isinstance(data, list) and len(data) > 0:
                df = pd.DataFrame(data)
            else:
                return pd.DataFrame()
            
            if df.empty:
                return pd.DataFrame()
                
            df['date'] = pd.to_datetime(df['date'])
            df.set_index('date', inplace=True)
            df.sort_index(ascending=True, inplace=True) # Ensure chronological order for rolling metrics
            
            df.rename(columns={
                'open': 'Open',
                'high': 'High',
                'low': 'Low',
                'close': 'Close',
                'volume': 'Volume'
            }, inplace=True)
            return df
        except Exception as e:
            log_error(f"Error fetching data from FMP for {ticker}: {e}")
            return pd.DataFrame()

    def fetch_basic_info(self, ticker: str) -> dict:
        url = f"{self.base_url}/profile?symbol={ticker}&apikey={self.api_key}"
        try:
            data = requests.get(url).json()
            if isinstance(data, list) and len(data) > 0:
                profile = data[0]
                return {
                    'shortName': profile.get('companyName', ticker),
                    'sector': profile.get('sector', 'N/A'),
                    'marketCap': profile.get('marketCap', 'N/A')
                }
        except Exception:
            pass
        return {}

    def fetch_aftermarket_quote(self, ticker: str) -> dict:
        url = f"https://financialmodelingprep.com/stable/aftermarket-quote?symbol={ticker}&apikey={self.api_key}"
        try:
            response = requests.get(url)
            data = response.json()
            if isinstance(data, list) and len(data) > 0:
                return data[0]
        except Exception:
            pass
        return {}

    def fetch_intraday_data(self, ticker: str, interval: str = "5min", from_date: str = "", to_date: str = "") -> pd.DataFrame:
        """取得 FMP 分鐘線歷史資料 (Starter Plan 支援 5min / 15min)"""
        url = f"{self.base_url}/historical-chart/{interval}?symbol={ticker}&apikey={self.api_key}&extended=true"
        if from_date:
            url += f"&from={from_date}"
        if to_date:
            url += f"&to={to_date}"
        try:
            response = requests.get(url)
            data = response.json()
            
            if not isinstance(data, list) or len(data) == 0:
                return pd.DataFrame()
            
            df = pd.DataFrame(data)
            df['date'] = pd.to_datetime(df['date'])
            df.set_index('date', inplace=True)
            df.sort_index(ascending=True, inplace=True)
            
            df.rename(columns={
                'open': 'Open', 'high': 'High',
                'low': 'Low', 'close': 'Close', 'volume': 'Volume'
            }, inplace=True)
            
            keep_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume'] if c in df.columns]
            return df[keep_cols]
        except Exception as e:
            log_error(f"Error fetching intraday data from FMP for {ticker}: {e}")
            return pd.DataFrame()

    def fetch_news(self, ticker: str, limit: int = 3) -> list:
        url = f"https://financialmodelingprep.com/stable/news/stock?symbols={ticker}&apikey={self.api_key}"
        try:
            response = requests.get(url)
            data = response.json()
            if isinstance(data, list):
                return data[:limit]
        except Exception:
            pass
        return []

    def fetch_screener_tickers(self, params: dict) -> list:
        query_string = "&".join(f"{k}={v}" for k, v in params.items() if v)
        url = f"{self.base_url}/company-screener?apikey={self.api_key}&{query_string}"#isActivelyTrading=true 查詢有活躍交易的股票
        try:
            response = requests.get(url)
            data = response.json()
            if isinstance(data, list):
                return [{"symbol": item["symbol"], "companyName": item.get("companyName", item.get("symbol")), "sector": item.get("sector", "N/A"), "marketCap": item.get("marketCap", "N/A")} for item in data if "symbol" in item]
        except Exception as e:
            log_error(f"Error fetching from FMP Screener: {e}")
        return []

    def fetch_biggest_gainers(self) -> list:
        url = f"{self.base_url}/biggest-gainers?apikey={self.api_key}"
        try:
            response = requests.get(url)
            data = response.json()
            if isinstance(data, list):
                return data
        except Exception as e:
            log_error(f"Error fetching biggest gainers from FMP: {e}")
        return []

    def fetch_quotes(self, tickers: list) -> list:
        if not tickers:
            return []
            
        chunk_size = 100
        results = []
        for i in range(0, len(tickers), chunk_size):
            chunk = tickers[i:i+chunk_size]
            symbols_str = ",".join(chunk)
            url = f"{self.base_url}/batch-quote?symbols={symbols_str}&apikey={self.api_key}"
            try:
                response = requests.get(url, timeout=15)
                if response.status_code == 200:
                    data = response.json()
                    if isinstance(data, list):
                        results.extend(data)
                else:
                    log_error(f"FMP Batch Quote API Error ({response.status_code}): {response.text}")
            except Exception as e:
                log_error(f"Error fetching batch quotes: {e}")
        return results

    def fetch_floats(self, tickers: list) -> dict:
        floats = {}
        if not tickers:
            return floats
            
        import concurrent.futures
        
        def fetch_single_float(ticker):
            url = f"{self.base_url}/shares-float?symbol={ticker}&apikey={self.api_key}"
            try:
                response = requests.get(url, timeout=10)
                if response.status_code != 200:
                    # Only print once to avoid spamming the screen
                    return None
                data = response.json()
                if isinstance(data, list) and len(data) > 0:
                    item = data[0]
                    if "symbol" in item and "floatShares" in item:
                        return (item["symbol"], item["floatShares"])
            except Exception:
                pass
            return None
            
        with concurrent.futures.ThreadPoolExecutor(max_workers=25) as executor:
            futures = [executor.submit(fetch_single_float, t) for t in tickers]
            for future in concurrent.futures.as_completed(futures):
                res = future.result()
                if res:
                    floats[res[0]] = res[1]
                    
        return floats

    def fetch_5min_closes(self, tickers: list, from_date: str = "", extended: bool = False) -> dict:
        closes = {}
        if not tickers:
            return closes
            
        import concurrent.futures
        
        def fetch_single(ticker):
            url = f"{self.base_url}/historical-chart/5min?symbol={ticker}&apikey={self.api_key}"
            if extended:
                url += "&extended=true"
            
            url_with_from = url
            if from_date:
                url_with_from += f"&from={from_date}"
                
            try:
                response = requests.get(url_with_from, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if isinstance(data, list) and len(data) >= 2:
                        closes_list = [c['close'] for c in data[1:11]]
                        return (ticker, closes_list)
                
                # Fallback: if from_date was specified but failed to return enough candles, try without it
                if from_date:
                    response = requests.get(url, timeout=10)
                    if response.status_code == 200:
                        data = response.json()
                        if isinstance(data, list) and len(data) >= 2:
                            closes_list = [c['close'] for c in data[1:11]]
                            return (ticker, closes_list)
            except Exception:
                pass
            return None
            
        with concurrent.futures.ThreadPoolExecutor(max_workers=25) as executor:
            results = executor.map(fetch_single, tickers)
            closes = {res[0]: res[1] for res in results if res}
                    
        return closes

    def fetch_1min_closes(self, tickers: list, from_date: str = "", extended: bool = False) -> dict:
        closes = {}
        if not tickers:
            return closes
            
        import concurrent.futures
        import datetime
        import threading
        
        req_count = 0
        count_lock = threading.Lock()
        
        def fetch_single(ticker):
            nonlocal req_count
            url = f"{self.base_url}/historical-chart/1min?symbol={ticker}&apikey={self.api_key}"
            if extended:
                url += "&extended=true"
            
            url_with_from = url
            if from_date:
                url_with_from += f"&from={from_date}"
                
            try:
                with count_lock:
                    req_count += 1
                    current_count = req_count
                print(f"[{datetime.datetime.now()}] [fetch_1min_closes] API request #{current_count} for {ticker}", flush=True)
                
                response = requests.get(url_with_from, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if isinstance(data, list) and len(data) >= 2:
                        closes_list = [c['close'] for c in data[1:11]]
                        return (ticker, closes_list)
                
                # Fallback: if from_date was specified but failed to return enough candles, try without it
                if from_date:
                    with count_lock:
                        req_count += 1
                        current_count = req_count
                    print(f"[{datetime.datetime.now()}] [fetch_1min_closes] API fallback request #{current_count} for {ticker}", flush=True)
                    
                    response = requests.get(url, timeout=10)
                    if response.status_code == 200:
                        data = response.json()
                        if isinstance(data, list) and len(data) >= 2:
                            closes_list = [c['close'] for c in data[1:11]]
                            return (ticker, closes_list)
            except Exception:
                pass
            return None
            
        with concurrent.futures.ThreadPoolExecutor(max_workers=25) as executor:
            results = executor.map(fetch_single, tickers)
            closes = {res[0]: res[1] for res in results if res}
                    
        return closes

@safe_cache_data(ttl=3600, show_spinner=False)
def get_historical_data(ticker: str, provider_name: str, period: str, api_key: str = "") -> pd.DataFrame:
    if provider_name == "FMP":
        provider = FMPProvider(api_key)
    else:
        provider = YFinanceProvider()
    return provider.fetch_historical_data(ticker, period)

@safe_cache_data(ttl=86400, show_spinner=False)
def get_basic_info(ticker: str, provider_name: str, api_key: str = "") -> dict:
    if provider_name == "FMP":
        provider = FMPProvider(api_key)
    else:
        provider = YFinanceProvider()
    return provider.fetch_basic_info(ticker)

@safe_cache_data(ttl=3600, show_spinner=False)
def get_fmp_screener_tickers(api_key: str, params: dict) -> list:
    provider = FMPProvider(api_key)
    return provider.fetch_screener_tickers(params)

@safe_cache_data(ttl=600, show_spinner=False)
def get_aftermarket_quote(ticker: str, provider_name: str, api_key: str = "") -> dict:
    if provider_name == "FMP":
        return FMPProvider(api_key).fetch_aftermarket_quote(ticker)
    return {}

@safe_cache_data(ttl=1800, show_spinner=False)
def get_stock_news(ticker: str, provider_name: str, api_key: str = "", limit: int = 3) -> list:
    if provider_name == "FMP":
        return FMPProvider(api_key).fetch_news(ticker, limit)
    return []

@safe_cache_data(ttl=600, show_spinner=False)
def get_intraday_data(ticker: str, interval: str, from_date: str, to_date: str, api_key: str = "") -> pd.DataFrame:
    """取得 FMP 分鐘線資料快取版 (TTL=10min)，僅支援 FMP Starter Plan 以上"""
    return FMPProvider(api_key).fetch_intraday_data(ticker, interval, from_date, to_date)

# Real-time screener specific functions (no cache or very short cache)
def get_realtime_biggest_gainers(api_key: str) -> list:
    # return FMPProvider(api_key).fetch_biggest_gainers()
    gainers = FMPProvider(api_key).fetch_biggest_gainers()
    return gainers[:20] if gainers else []

def get_realtime_quotes(api_key: str, tickers: list) -> list:
    return FMPProvider(api_key).fetch_quotes(tickers)

@safe_cache_data(ttl=3600, show_spinner=False)
def get_floats(api_key: str, tickers: list) -> dict:
    return FMPProvider(api_key).fetch_floats(tickers)

def get_realtime_5min_closes(api_key: str, tickers: list, from_date: str = "", extended: bool = False) -> dict:
    return FMPProvider(api_key).fetch_5min_closes(tickers, from_date, extended)

def get_realtime_1min_closes(api_key: str, tickers: list, from_date: str = "", extended: bool = False) -> dict:
    return FMPProvider(api_key).fetch_1min_closes(tickers, from_date, extended)
