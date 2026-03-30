import yfinance as yf
import pandas as pd
import streamlit as st
import requests
from abc import ABC, abstractmethod

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
            st.error(f"Error fetching data from YFinance for {ticker}: {e}")
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
            st.error(f"Error fetching data from FMP for {ticker}: {e}")
            return pd.DataFrame()

    def fetch_basic_info(self, ticker: str) -> dict:
        url = f"{self.base_url}/profile?symbol={ticker}&apikey={self.api_key}"
        try:
            data = requests.get(url).json()
            if isinstance(data, list) and len(data) > 0:
                profile = data[0]
                return {
                    'shortName': profile.get('companyName', ticker),
                    'sector': profile.get('sector', 'N/A')
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
        url = f"{self.base_url}/company-screener?apikey={self.api_key}&{query_string}"
        try:
            response = requests.get(url)
            data = response.json()
            if isinstance(data, list):
                return [{"symbol": item["symbol"], "companyName": item.get("companyName", item.get("symbol")), "sector": item.get("sector", "N/A")} for item in data if "symbol" in item]
        except Exception as e:
            st.error(f"Error fetching from FMP Screener: {e}")
        return []

@st.cache_data(ttl=3600, show_spinner=False)
def get_historical_data(ticker: str, provider_name: str, period: str, api_key: str = "") -> pd.DataFrame:
    if provider_name == "FMP":
        provider = FMPProvider(api_key)
    else:
        provider = YFinanceProvider()
    return provider.fetch_historical_data(ticker, period)

@st.cache_data(ttl=86400, show_spinner=False)
def get_basic_info(ticker: str, provider_name: str, api_key: str = "") -> dict:
    if provider_name == "FMP":
        provider = FMPProvider(api_key)
    else:
        provider = YFinanceProvider()
    return provider.fetch_basic_info(ticker)

@st.cache_data(ttl=3600, show_spinner=False)
def get_fmp_screener_tickers(api_key: str, params: dict) -> list:
    provider = FMPProvider(api_key)
    
    p_min = params.get("priceMoreThan", 0)
    p_max = params.get("priceLowerThan", 0)
    
    # 若有給定有效的上下界價格區間，啟動多區間自動分桶爬取機制
    if p_max > p_min and p_max > 0:
        import concurrent.futures
        num_chunks = 5
        price_step = (p_max - p_min) / num_chunks
        
        chunk_params = []
        for i in range(num_chunks):
            cp = params.copy()
            chunk_p_min = p_min + i * price_step
            chunk_p_max = p_min + (i + 1) * price_step if i < num_chunks - 1 else p_max
            
            cp["priceMoreThan"] = round(chunk_p_min, 2)
            cp["priceLowerThan"] = round(chunk_p_max, 2)
            chunk_params.append(cp)
            
        all_items = {}
        # 並行發送多個 Screener 請求
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            future_to_cp = {executor.submit(provider.fetch_screener_tickers, cp): cp for cp in chunk_params}
            for future in concurrent.futures.as_completed(future_to_cp):
                try:
                    res = future.result()
                    if res:
                        for item in res:
                            all_items[item["symbol"]] = item
                except Exception:
                    pass
        return list(all_items.values())
    else:
        # 沒有設定上限，或是條件不構成區間時，回退到單次請求模式
        return provider.fetch_screener_tickers(params)

@st.cache_data(ttl=600, show_spinner=False)
def get_aftermarket_quote(ticker: str, provider_name: str, api_key: str = "") -> dict:
    if provider_name == "FMP":
        return FMPProvider(api_key).fetch_aftermarket_quote(ticker)
    return {}

@st.cache_data(ttl=1800, show_spinner=False)
def get_stock_news(ticker: str, provider_name: str, api_key: str = "", limit: int = 3) -> list:
    if provider_name == "FMP":
        return FMPProvider(api_key).fetch_news(ticker, limit)
    return []
