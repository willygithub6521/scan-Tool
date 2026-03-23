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
        self.base_url = "https://financialmodelingprep.com/api/v3"

    def fetch_historical_data(self, ticker: str, period: str = "1y") -> pd.DataFrame:
        # Map Streamlit periods to FMP timeseries lengths (rough approximate trading days)
        days_map = {"1mo": 22, "3mo": 66, "6mo": 130, "1y": 252, "2y": 504, "5y": 1260, "max": 5000}
        timeseries = days_map.get(period, 252)
        
        url = f"{self.base_url}/historical-price-full/{ticker}?timeseries={timeseries}&apikey={self.api_key}"
        try:
            response = requests.get(url)
            data = response.json()
            if "historical" not in data:
                return pd.DataFrame()
            
            df = pd.DataFrame(data["historical"])
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
        url = f"{self.base_url}/profile/{ticker}?apikey={self.api_key}"
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

    def fetch_screener_tickers(self, params: dict) -> list:
        query_string = "&".join(f"{k}={v}" for k, v in params.items() if v)
        url = f"{self.base_url}/stock-screener?apikey={self.api_key}&{query_string}"
        try:
            response = requests.get(url)
            data = response.json()
            if isinstance(data, list):
                return [item['symbol'] for item in data]
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
    return provider.fetch_screener_tickers(params)
