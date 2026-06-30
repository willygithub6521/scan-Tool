import React, { useState } from 'react';
import axios from 'axios';
import {
  Play,
  Download,
  Bookmark,
  TrendingUp,
  ChevronRight,
  X,
  Sliders,
  Activity,
  FileSpreadsheet
} from 'lucide-react';
import TradingViewChart from './TradingViewChart';

interface HistoricalScannerProps {
  apiKey: string;
  onSaveScan: (df: any[]) => void;
  BASE_URL: string;
}

// ─── NumericInput: prevents React forcing 0 when input is cleared ────────────
interface NumericInputProps {
  value: number;
  onChange: (val: number) => void;
  step?: number;
  min?: number;
  className?: string;
  placeholder?: string;
}

const NumericInput: React.FC<NumericInputProps> = ({
  value, onChange, step, min, className, placeholder
}) => {
  // Local string buffer lets the user freely clear/type without React snapping back to 0
  const [localVal, setLocalVal] = React.useState(String(value));

  // Sync when external state changes (e.g. reset)
  React.useEffect(() => {
    setLocalVal(String(value));
  }, [value]);

  return (
    <input
      type="number"
      step={step}
      min={min}
      placeholder={placeholder}
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        const parsed = parseFloat(localVal);
        const committed = isNaN(parsed) ? 0 : parsed;
        setLocalVal(String(committed));
        onChange(committed);
      }}
      className={className}
    />
  );
};
// ─────────────────────────────────────────────────────────────────────────────

export const HistoricalScanner: React.FC<HistoricalScannerProps> = ({ apiKey, onSaveScan, BASE_URL }) => {
  // Config state
  const [dataSource, setDataSource] = useState<'FMP' | 'Yahoo Finance'>('FMP');
  const [inputMethod, setInputMethod] = useState<string>('手動輸入');
  const [tickersInput, setTickersInput] = useState<string>('AAPL\nMSFT\nGOOGL\nNVDA\nTSLA');
  const [csvTickers, setCsvTickers] = useState<string[]>([]);
  const [period, setPeriod] = useState<string>('2y');

  // FMP Server Params
  const [mktCapMin, setMktCapMin] = useState<number>(0);
  const [mktCapMax, setMktCapMax] = useState<number>(500);
  const [priceMin, setPriceMin] = useState<number>(1.0);
  const [priceMax, setPriceMax] = useState<number>(5.0);
  const [volMin, setVolMin] = useState<number>(1.0);
  const [volMax, setVolMax] = useState<number>(500);
  const [sector, setSector] = useState<string>('');
  const [industry] = useState<string>('');
  const [limit, setLimit] = useState<number>(5000);

  // Indicators
  const [smaWindow, setSmaWindow] = useState<number>(50);
  const [showSmaCols, setShowSmaCols] = useState<boolean>(false);

  // Return filters
  const [min1dReturn, setMin1dReturn] = useState<number>(50.0);
  const [nDaysReturn, setNDaysReturn] = useState<number>(5);
  const [minNdReturn, setMinNdReturn] = useState<number>(50.0);
  const [matchLogic, setMatchLogic] = useState<'OR' | 'AND'>('OR');
  const [strictReturnFilter, setStrictReturnFilter] = useState<boolean>(false);

  // Strategy specific configurations
  const [strategySelect, setStrategySelect] = useState<string>('1.Extended Short');
  const [extMinDailyRet, setExtMinDailyRet] = useState<number>(90.0);
  const [extMinBodyRet, setExtMinBodyRet] = useState<number>(70.0);
  const [extTimeRangeMin, setExtTimeRangeMin] = useState<number>(0);
  const [extTimeRangeMax, setExtTimeRangeMax] = useState<number>(12);
  const [extEnableAdv, setExtEnableAdv] = useState<boolean>(false);
  const [extAdvNDays, setExtAdvNDays] = useState<number>(1);
  const [extAdvRetDir, setExtAdvRetDir] = useState<'漲' | '跌'>('跌');
  const [extAdvRetType, setExtAdvRetType] = useState<'大於' | '小於'>('大於');
  const [extAdvRetVal, setExtAdvRetVal] = useState<number>(0.0);
  const [extAdvStrict] = useState<boolean>(false);

  // Fake Breakout
  const [fbMinGap, setFbMinGap] = useState<number>(30.0);
  const [fbMinVolM, setFbMinVolM] = useState<number>(10.0);
  const [fbMinPrevClose, setFbMinPrevClose] = useState<number>(1.0);
  const [fbMinShadowRatio, setFbMinShadowRatio] = useState<number>(60.0);
  const [fbTimeRangeMin, setFbTimeRangeMin] = useState<number>(0);
  const [fbTimeRangeMax, setFbTimeRangeMax] = useState<number>(12);

  // QullaMaggie Breakout & Single Day Breakout
  const [qmDaysInputType, setQmDaysInputType] = useState('依月份選擇');
  const [qmSelMonth, setQmSelMonth] = useState('3個月');
  const [qmDaysManual, setQmDaysManual] = useState<number>(20);
  const [qmMinRet, setQmMinRet] = useState<number>(30.0);
  const [useBodyFilter, setUseBodyFilter] = useState<boolean>(false);
  const [minBodyRet, setMinBodyRet] = useState<number>(15.0);
  const [strictHistoryFilter, setStrictHistoryFilter] = useState<boolean>(false);

  // Volatility
  const [volMultiplier, setVolMultiplier] = useState<number>(10.0);
  const [strictVolFilter, setStrictVolFilter] = useState<boolean>(false);

  // UI state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showSubSidebar, setShowSubSidebar] = useState<boolean>(() => {
    const saved = localStorage.getItem('HIST_showSubSidebar');
    return saved !== null ? saved === 'true' : true;
  });
  const [scanProgress, setScanProgress] = useState<{ processed: number, total: number } | null>(null);
  const [screenerCount, setScreenerCount] = useState<number | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [deepDiveData, setDeepDiveData] = useState<any>(null);
  const [isChartLoading, setIsChartLoading] = useState<boolean>(false);

  // Handle CSV file upload
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      const list = lines
        .map(line => line.split(',')[0].trim().toUpperCase())
        .filter(t => t.length > 0 && t !== 'SYMBOL' && t !== 'TICKER');
      setCsvTickers(list);
    };
    reader.readAsText(file);
  };

  // Run historical stock scan
  const handleStartScan = async () => {
    setIsLoading(true);
    setScanProgress(null);
    setScreenerCount(null);
    setErrorMsg('');
    setResults([]);

    // Get final tickers list
    let finalTickers: string[] = [];
    if (inputMethod === '手動輸入') {
      finalTickers = tickersInput
        .replace(/\n/g, ',')
        .split(',')
        .map(t => t.trim().toUpperCase())
        .filter(t => t.length > 0);
    } else if (inputMethod === 'CSV 上傳') {
      finalTickers = csvTickers;
    }

    if (inputMethod === 'FMP 伺服器端進階篩選') {
      try {
        const screenerPayload = {
          fmp_api_key: apiKey || null,
          params: {
            marketCapMoreThan: mktCapMin * 1000000,
            marketCapLowerThan: mktCapMax * 1000000,
            priceMoreThan: priceMin,
            priceLowerThan: priceMax,
            volumeMoreThan: volMin * 1000000,
            volumeLowerThan: volMax * 1000000,
            sector: sector || null,
            industry: industry || null,
            limit: limit
          }
        };
        const res = await axios.post(`${BASE_URL}/api/fmp-screener`, screenerPayload);
        const fetchedTickers = res.data.results.map((r: any) => r.symbol);
        finalTickers = fetchedTickers;
        setScreenerCount(fetchedTickers.length);
      } catch (err: any) {
        setErrorMsg(err.response?.data?.detail || '請求 FMP Screener API 錯誤');
        setIsLoading(false);
        return;
      }
    }

    if (finalTickers.length === 0) {
      setErrorMsg(inputMethod === 'FMP 伺服器端進階篩選' ? 'FMP 伺服器未找到符合條件的股票' : '請輸入至少一檔股票代碼或上傳 CSV！');
      setIsLoading(false);
      return;
    }

    // Build payload template
    const payloadTemplate = {
      data_source: dataSource,
      fmp_api_key: apiKey || null,
      input_method: '手動輸入', // Always manual since we resolved tickers
      tickers: [],
      fmp_server_params: null,
      period: period,
      sma_window: smaWindow,
      show_sma_cols: showSmaCols,
      min_1d_return: min1dReturn,
      n_days_return: nDaysReturn,
      min_nd_return: minNdReturn,
      match_logic: matchLogic === 'OR' ? 'OR (任一條件達標即可)' : 'AND (全部條件皆須達標)',
      strict_return_filter: strictReturnFilter,
      strategy_select: strategySelect,
      hist_cfg: strategySelect === '1.Extended Short' ? {
        min_daily_ret: extMinDailyRet,
        min_body_ret: extMinBodyRet,
        time_range: [extTimeRangeMin, extTimeRangeMax],
        enable_adv: extEnableAdv,
        adv_n_days: extAdvNDays,
        adv_ret_dir: extAdvRetDir,
        adv_ret_type: extAdvRetType,
        adv_ret_val: extAdvRetVal,
        adv_strict: extAdvStrict
      } : strategySelect === '2.Fake Breakout Short' ? {
        min_gap: fbMinGap,
        min_vol_m: fbMinVolM,
        min_prev_close: fbMinPrevClose,
        min_shadow_ratio: fbMinShadowRatio,
        time_range: [fbTimeRangeMin, fbTimeRangeMax]
      } : strategySelect === '4.曾經單日漲幅Breakout' ? {
        qm_days: qmDaysInputType === '依月份選擇' ? (qmSelMonth === '1個月' ? 21 : qmSelMonth === '3個月' ? 63 : 126) : qmDaysManual,
        qm_min_ret: qmMinRet,
        use_body_filter: useBodyFilter,
        min_body_ret: minBodyRet
      } : {
        qm_days: qmDaysInputType === '依月份選擇' ? (qmSelMonth === '1個月' ? 21 : qmSelMonth === '3個月' ? 63 : 126) : qmDaysManual,
        qm_min_ret: qmMinRet
      },
      strict_history_filter: strictHistoryFilter,
      vol_multiplier: volMultiplier,
      strict_vol_filter: strictVolFilter
    };

    try {
      const chunkSize = 20;
      let allResults: any[] = [];

      setScanProgress({ processed: 0, total: finalTickers.length });

      for (let i = 0; i < finalTickers.length; i += chunkSize) {
        const chunk = finalTickers.slice(i, i + chunkSize);
        const currentPayload = { ...payloadTemplate, tickers: chunk };

        const response = await axios.post(`${BASE_URL}/api/scan`, currentPayload);
        allResults = [...allResults, ...response.data.results];

        setScanProgress({ processed: Math.min(i + chunkSize, finalTickers.length), total: finalTickers.length });
      }

      setResults(allResults);
      if (allResults.length === 0) {
        setErrorMsg('掃描完成，未發現符合篩選條件的標的，請放寬條件。');
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || '請求後端 API 錯誤，請確認後端是否正常啟動。');
    } finally {
      setIsLoading(false);
      setScanProgress(null);
    }
  };

  // Open interactive chart and news for ticker
  const handleTickerClick = async (ticker: string) => {
    setSelectedTicker(ticker);
    setIsChartLoading(true);
    setChartData([]);
    setDeepDiveData(null);

    try {
      // 1. Fetch historical candle data
      const histResponse = await axios.get(
        `${BASE_URL}/api/stocks/${ticker}/historical?provider=${dataSource}&period=2y&sma_window=${smaWindow}&api_key=${apiKey}`
      );
      setChartData(histResponse.data.data);

      // 2. Fetch deep dive news
      const diveResponse = await axios.get(
        `${BASE_URL}/api/stocks/${ticker}/deep-dive?provider=${dataSource}&api_key=${apiKey}`
      );
      setDeepDiveData(diveResponse.data);
    } catch (err) {
      console.error('Failed to fetch stock detail:', err);
    } finally {
      setIsChartLoading(false);
    }
  };

  const filteredResults = results.filter(row => {
    if (strictReturnFilter) {
      const is1dPassed = row["1日漲幅達標"] === '✅';
      const isNdPassed = row[`${nDaysReturn}日漲幅達標`] === '✅';
      if (matchLogic === 'OR' && !is1dPassed && !isNdPassed) return false;
      if (matchLogic === 'AND' && (!is1dPassed || !isNdPassed)) return false;
    }

    if (strictVolFilter) {
      if (row["爆量達標"] !== '✅') return false;
    }

    if (strictHistoryFilter) {
      const histKeys = ["歷史暴漲達標", "歷史假突破達標", "QullaMaggie突破達標", "單日漲幅Breakout達標"];
      const passedAnyHist = histKeys.some(key => row[key] === '✅');
      if (!passedAnyHist) return false;
    }

    return true;
  });

  const isReturnKey = (k: string) => /^\d+日漲幅\(%\)$/.test(k) || /^\d+日漲幅達標$/.test(k);
  const isVolKey = (k: string) => k === "RVOL (倍)" || k === "爆量達標";
  const isBaseKey = (k: string) => ["Ticker", "Name", "Sector", "Market Cap", "Close"].includes(k);
  const isSmaKey = (k: string) => k.startsWith("SMA_") || k === "Price > SMA";
  const isNewsKey = (k: string) => k === "📰 News";

  const historyKeys = results[0] ? Object.keys(results[0]).filter(k =>
    !isBaseKey(k) && !isSmaKey(k) && !isReturnKey(k) && !isVolKey(k) && !isNewsKey(k)
  ) : [];

  const returnKeys = results[0] ? Object.keys(results[0]).filter(k => isReturnKey(k)) : [];
  const volKeys = results[0] ? Object.keys(results[0]).filter(k => isVolKey(k)) : [];

  // Export results to CSV
  const handleExportCsv = () => {
    if (filteredResults.length === 0) return;
    const headers = Object.keys(filteredResults[0]).join(',');
    const rows = filteredResults.map(row =>
      Object.values(row).map(val => {
        const str = String(val);
        return str.includes(',') ? `"${str}"` : str;
      }).join(',')
    );
    const csvContent = "data:text/csv;charset=utf-8-sig,\uFEFF" + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `screener_results_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-gray-900 text-gray-100 p-8">
      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <span>📈 歷史策略掃描</span>
            <span className="text-xs bg-indigo-500/20 text-indigo-400 font-semibold px-2 py-0.5 rounded-full">Historical Scanner</span>
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            設定策略過濾器，從大範圍或特定的股票清單中篩選出潛在的高動能標的。
          </p>
        </div>

        {/* Toggle sub sidebar button */}
        <button
          onClick={() => setShowSubSidebar(prev => !prev)}
          className="pb-1 text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer flex items-center space-x-1.5"
        >
          <Sliders size={12} className={showSubSidebar ? 'text-indigo-400' : 'text-gray-500'} />
          <span>{showSubSidebar ? '隱藏控制欄' : '顯示控制欄'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left Side: Filters Column */}
        {showSubSidebar && (
          <div className="xl:col-span-1 bg-gray-950/40 p-6 rounded-2xl border border-gray-800 space-y-6 max-h-[85vh] overflow-y-auto animate-in slide-in-from-left duration-200">
            {/* Main settings */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2">
              <Sliders size={14} className="text-indigo-400" />
              <span>基礎配置</span>
            </h3>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">資料來源</label>
              <select
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value as any)}
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="FMP">Financial Modeling Prep (FMP)</option>
                <option value="Yahoo Finance">Yahoo Finance</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">目標產生方式</label>
              <div className="flex flex-col space-y-1.5 mt-1">
                {['手動輸入', 'CSV 上傳', 'FMP 伺服器端進階篩選'].map((method) => {
                  if (method === 'FMP 伺服器端進階篩選' && dataSource !== 'FMP') return null;
                  return (
                    <label key={method} className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
                      <input
                        type="radio"
                        name="inputMethod"
                        value={method}
                        checked={inputMethod === method}
                        onChange={() => setInputMethod(method)}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{method}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Inputs based on selection */}
            {inputMethod === '手動輸入' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">股票代碼 (逗號或換行分隔)</label>
                <textarea
                  value={tickersInput}
                  onChange={(e) => setTickersInput(e.target.value)}
                  className="w-full h-24 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {inputMethod === 'CSV 上傳' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">上傳 CSV 檔案 (首欄必須為股票代號)</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCsvUpload}
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-400 focus:outline-none focus:border-indigo-500"
                />
                {csvTickers.length > 0 && (
                  <p className="text-[10px] text-green-400">已解析 {csvTickers.length} 檔代碼</p>
                )}
              </div>
            )}

            {inputMethod === 'FMP 伺服器端進階篩選' && (
              <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-800">
                <h4 className="text-xs font-bold text-gray-400">API 伺服器過濾引數</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500 block">最低市值 (M)</label>
                    <NumericInput value={mktCapMin} onChange={setMktCapMin} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">最高市值 (M)</label>
                    <NumericInput value={mktCapMax} onChange={setMktCapMax} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">股價大於 ($)</label>
                    <NumericInput value={priceMin} onChange={setPriceMin} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">股價小於 ($)</label>
                    <NumericInput value={priceMax} onChange={setPriceMax} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">最低成交量 (M)</label>
                    <NumericInput value={volMin} onChange={setVolMin} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">最高成交量 (M)</label>
                    <NumericInput value={volMax} onChange={setVolMax} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">大板塊 (Sector)</label>
                  <select value={sector} onChange={(e) => setSector(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white">
                    <option value="">全部</option>
                    <option value="Technology">Technology</option>
                    <option value="Healthcare">Healthcare</option>
                    <option value="Financial Services">Financial Services</option>
                    <option value="Energy">Energy</option>
                    <option value="Consumer Cyclical">Consumer Cyclical</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">返回限制數量</label>
                  <NumericInput value={limit} onChange={setLimit} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">資料天數期間 (K線)</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="1mo">1個月</option>
                <option value="3mo">3個月</option>
                <option value="6mo">6個月</option>
                <option value="1y">1年</option>
                <option value="2y">2年</option>
                <option value="5y">5年</option>
              </select>
            </div>
          </div>

          {/* Technical Indicators */}
          <div className="space-y-3 pt-4 border-t border-gray-800/80">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">技術指標與顯示</h3>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-300">SMA 移動平均天數</label>
              <NumericInput
                value={smaWindow}
                onChange={setSmaWindow}
                className="w-16 bg-gray-900 border border-gray-800 rounded-xl px-2 py-1 text-sm text-center text-white"
              />
            </div>
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showSmaCols}
                onChange={(e) => setShowSmaCols(e.target.checked)}
                className="text-indigo-600 focus:ring-indigo-500 rounded"
              />
              <span>顯示 SMA 相關欄位</span>
            </label>
          </div>

          {/* Return Filter */}
          <div className="space-y-4 pt-4 border-t border-gray-800/80">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">動能漲幅篩選 (Client-Side)</h3>
            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <label className="text-xs text-gray-500 whitespace-nowrap">爆量倍數 (RVOL)</label>
                <NumericInput value={volMultiplier} onChange={setVolMultiplier} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 text-sm text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-500">單日最低漲幅 (%)</label>
                <NumericInput value={min1dReturn} onChange={setMin1dReturn} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 text-sm text-white" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500 block">區間天數 (N)</label>
                  <NumericInput value={nDaysReturn} onChange={setNDaysReturn} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">N日最低漲幅 (%)</label>
                  <NumericInput value={minNdReturn} onChange={setMinNdReturn} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block">交集邏輯</label>
                <select value={matchLogic} onChange={(e) => setMatchLogic(e.target.value as any)} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-xs text-white">
                  <option value="OR">OR (任一滿足即可)</option>
                  <option value="AND">AND (全部條件滿足)</option>
                </select>
              </div>
              <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={strictReturnFilter}
                  onChange={(e) => setStrictReturnFilter(e.target.checked)}
                  className="text-indigo-600 focus:ring-indigo-500 rounded"
                />
                <span>啟用嚴格漲幅過濾</span>
              </label>
            </div>
          </div>

          {/* Strategy Section */}
          <div className="space-y-4 pt-4 border-t border-gray-800/80">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">歷史記錄與策略模型</h3>
            <div className="space-y-2">
              <label className="text-xs text-gray-500">策略篩選器</label>
              <select
                value={strategySelect}
                onChange={(e) => setStrategySelect(e.target.value)}
                className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-xs text-white"
              >
                <option value="1.Extended Short">1. Extended Short</option>
                <option value="2.Fake Breakout Short">2. Fake Breakout Short</option>
                <option value="3.QullaMaggie Breakout">3. QullaMaggie Breakout</option>
                <option value="4.曾經單日漲幅Breakout">4. 曾經單日漲幅Breakout</option>
              </select>
            </div>

            {/* Strategy params */}
            {strategySelect === '1.Extended Short' && (
              <div className="space-y-3 bg-gray-900/40 p-3 rounded-lg border border-gray-800 text-xs">
                <div>
                  <label className="text-gray-500 block">曾單日總漲幅大於 (%)</label>
                  <NumericInput value={extMinDailyRet} onChange={setExtMinDailyRet} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div>
                  <label className="text-gray-500 block">曾單日實體大於 (%)</label>
                  <NumericInput value={extMinBodyRet} onChange={setExtMinBodyRet} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500">時間範圍起 (月)</label>
                    <NumericInput value={extTimeRangeMin} onChange={setExtTimeRangeMin} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">時間範圍止 (月)</label>
                    <NumericInput value={extTimeRangeMax} onChange={setExtTimeRangeMax} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-800/60 mt-2">
                  <label className="flex items-center space-x-2 text-sm font-medium text-gray-400 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={extEnableAdv}
                      onChange={(e) => setExtEnableAdv(e.target.checked)}
                      className="text-indigo-600 focus:ring-indigo-500 rounded"
                    />
                    <span>啟用未來走勢預測</span>
                  </label>
                  {extEnableAdv && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <label className="text-[10px] text-gray-500 block">未來天數</label>
                        <NumericInput value={extAdvNDays} onChange={setExtAdvNDays} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 text-white" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block">預期方向</label>
                        <select value={extAdvRetDir} onChange={(e) => setExtAdvRetDir(e.target.value as any)} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 text-white">
                          <option value="漲">漲</option>
                          <option value="跌">跌</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block">漲跌幅條件</label>
                        <select value={extAdvRetType} onChange={(e) => setExtAdvRetType(e.target.value as any)} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 text-white">
                          <option value="大於">大於</option>
                          <option value="小於">小於</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block">目標值 (%)</label>
                        <NumericInput value={extAdvRetVal} onChange={setExtAdvRetVal} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 text-white" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {strategySelect === '2.Fake Breakout Short' && (
              <div className="space-y-3 bg-gray-900/40 p-3 rounded-lg border border-gray-800 text-xs">
                <div>
                  <label className="text-gray-500 block">跳空Gap大於 (%)</label>
                  <NumericInput value={fbMinGap} onChange={setFbMinGap} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div>
                  <label className="text-gray-500 block">上影線比例大於 (%)</label>
                  <NumericInput value={fbMinShadowRatio} onChange={setFbMinShadowRatio} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div>
                  <label className="text-gray-500 block">當日成交量大於 (M)</label>
                  <NumericInput value={fbMinVolM} onChange={setFbMinVolM} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div>
                  <label className="text-gray-500 block">昨日收盤價大於 ($)</label>
                  <NumericInput value={fbMinPrevClose} onChange={setFbMinPrevClose} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="text-[10px] text-gray-500 block">時間範圍起(月)</label>
                    <NumericInput value={fbTimeRangeMin} onChange={setFbTimeRangeMin} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">時間範圍止(月)</label>
                    <NumericInput value={fbTimeRangeMax} onChange={setFbTimeRangeMax} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                  </div>
                </div>
              </div>
            )}

            {(strategySelect === '3.QullaMaggie Breakout' || strategySelect === '4.曾經單日漲幅Breakout') && (
              <div className="space-y-3 bg-gray-900/40 p-3 rounded-lg border border-gray-800 text-xs">
                <div>
                  <label className="text-gray-500 block">期間天數設定</label>
                  <select value={qmDaysInputType} onChange={(e) => setQmDaysInputType(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white">
                    <option value="依月份選擇">依月份選擇</option>
                    <option value="手動輸入">手動輸入</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className={`transition-opacity ${qmDaysInputType !== '手動輸入' ? 'opacity-50 pointer-events-none' : ''}`}>
                    <label className="text-gray-500 block text-[10px]">自定義天數</label>
                    <NumericInput
                      value={qmDaysManual}
                      onChange={setQmDaysManual}
                      className={`w-full border border-gray-800 rounded px-2 py-1 text-white ${qmDaysInputType !== '手動輸入' ? 'bg-gray-800/50 cursor-not-allowed' : 'bg-gray-900'}`}
                    />
                  </div>
                  <div>
                    <label className="text-gray-500 block text-[10px]">近期累計漲幅大於(%)</label>
                    <NumericInput value={qmMinRet} onChange={setQmMinRet} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 text-white" />
                  </div>
                </div>

                {qmDaysInputType === '依月份選擇' && (
                  <select value={qmSelMonth} onChange={(e) => setQmSelMonth(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white">
                    <option value="1個月">1個月 (21日)</option>
                    <option value="3個月">3個月 (63日)</option>
                    <option value="6個月">6個月 (126日)</option>
                  </select>
                )}

                {strategySelect === '4.曾經單日漲幅Breakout' && (
                  <div className="pt-2 border-t border-gray-800/60 mt-3">
                    <label className="flex items-center space-x-2 text-sm font-medium text-gray-400 cursor-pointer mb-2">
                      <input
                        type="checkbox"
                        checked={useBodyFilter}
                        onChange={(e) => setUseBodyFilter(e.target.checked)}
                        className="text-indigo-600 focus:ring-indigo-500 rounded"
                      />
                      <span>啟用長綠K線篩選</span>
                    </label>
                    {useBodyFilter && (
                      <div>
                        <label className="text-gray-500 block text-[10px]">實體長度大於(%)</label>
                        <NumericInput value={minBodyRet} onChange={setMinBodyRet} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={strictHistoryFilter}
                onChange={(e) => setStrictHistoryFilter(e.target.checked)}
                className="text-indigo-600 focus:ring-indigo-500 rounded"
              />
              <span className="ml-2 text-sm text-gray-300">
                啟用 {strategySelect === '3.QullaMaggie Breakout' ? 'QullaMaggie 突破' : '曾經單日漲幅Breakout'} 過濾 (獨立篩選)
              </span>
            </label>
          </div>

          {/* RVOL Volume */}
          <div className="space-y-3 pt-4 border-t border-gray-800/80">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">交易量爆量篩選 (RVOL)</h3>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-300">RVOL 異常倍數</label>
              <input
                type="number"
                value={volMultiplier}
                onChange={(e) => setVolMultiplier(Number(e.target.value))}
                className="w-16 bg-gray-900 border border-gray-800 rounded-xl px-2 py-1 text-sm text-center text-white"
              />
            </div>
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={strictVolFilter}
                onChange={(e) => setStrictVolFilter(e.target.checked)}
                className="text-indigo-600 focus:ring-indigo-500 rounded"
              />
              <span>僅顯示爆量達標股票</span>
            </label>
          </div>

          {/* Progress & Status */}
          {isLoading && (
            <div className="space-y-2 bg-gray-900/50 p-4 rounded-xl border border-gray-800">
              <div className="flex justify-between items-center text-xs text-gray-400">
                <span className="font-semibold text-indigo-400">
                  {screenerCount !== null ? `Screener 找到 ${screenerCount} 檔股票` : '準備中...'}
                </span>
                <span>
                  {scanProgress ? `${scanProgress.processed} / ${scanProgress.total}` : ''}
                </span>
              </div>
              {scanProgress && (
                <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-indigo-500 h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(5, (scanProgress.processed / scanProgress.total) * 100)}%` }}
                  ></div>
                </div>
              )}
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleStartScan}
            disabled={isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/40 text-white rounded-xl py-3 px-4 font-semibold text-sm shadow-lg shadow-indigo-600/35 transition-colors duration-150 flex items-center justify-center space-x-2 cursor-pointer"
          >
            {isLoading ? (
              <>
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                <span>搜尋中...</span>
              </>
            ) : (
              <>
                <Play size={16} />
                <span>開始統一搜尋 🚀</span>
              </>
            )}
          </button>
        </div>
        )}

        {/* Right Side: Data View Column */}
        <div className={`space-y-6 flex flex-col min-h-[85vh] ${showSubSidebar ? 'xl:col-span-3' : 'xl:col-span-4'}`}>
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-sm">
              {errorMsg}
            </div>
          )}

          {results.length > 0 ? (
            <div className="bg-gray-950/40 border border-gray-800 rounded-2xl overflow-hidden flex flex-col flex-1 shadow-xl">
              {/* Table Toolbar */}
              <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-950/60">
                <span className="text-sm font-semibold text-gray-300">
                  找到 {filteredResults.length} 檔股票符合條件
                </span>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleExportCsv}
                    className="bg-gray-900 hover:bg-gray-800 text-gray-200 border border-gray-800 rounded-xl px-3.5 py-2 text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer"
                  >
                    <Download size={14} />
                    <span>匯出 CSV</span>
                  </button>
                  <button
                    onClick={() => {
                      onSaveScan(filteredResults);
                      alert('已成功將篩選結果儲存至歷次保存庫！');
                    }}
                    className="bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 rounded-xl px-3.5 py-2 text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer"
                  >
                    <Bookmark size={14} />
                    <span>儲存至歷史庫存</span>
                  </button>
                </div>
              </div>

              {/* Table Data */}
              <div className="overflow-x-auto overflow-y-auto flex-1 max-h-[70vh]">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-900/60 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase">
                      <th className="py-4 px-6">代碼</th>
                      <th className="py-4 px-6">名稱</th>
                      <th className="py-4 px-6">產業板塊</th>
                      <th className="py-4 px-6">市值</th>
                      <th className="py-4 px-6 text-right">收盤價</th>
                      {showSmaCols && <th className="py-4 px-6 text-center whitespace-nowrap">SMA ({smaWindow})</th>}
                      {showSmaCols && <th className="py-4 px-6 text-center whitespace-nowrap">價 &gt; SMA</th>}
                      {strictReturnFilter && returnKeys.map(key => (
                        <th key={key} className="py-4 px-6 text-center whitespace-nowrap">{key}</th>
                      ))}
                      {strictVolFilter && volKeys.map(key => (
                        <th key={key} className="py-4 px-6 text-center whitespace-nowrap">{key}</th>
                      ))}
                      {strictHistoryFilter && historyKeys.map(key => (
                        <th key={key} className="py-4 px-6 text-center whitespace-nowrap">{key}</th>
                      ))}
                      <th className="py-4 px-6 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/80">
                    {filteredResults.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-800/30 transition-colors">
                        <td className="py-3.5 px-6 font-bold text-white tracking-wide">{row.Ticker}</td>
                        <td className="py-3.5 px-6 text-gray-300 font-medium truncate max-w-[150px]">{row.Name}</td>
                        <td className="py-3.5 px-6 text-gray-400">{row.Sector}</td>
                        <td className="py-3.5 px-6 text-gray-400">{row["Market Cap"]}</td>
                        <td className="py-3.5 px-6 text-right font-semibold text-gray-100">${row.Close}</td>
                        {showSmaCols && <td className="py-3.5 px-6 text-center text-gray-400">${row[`SMA_${smaWindow}`]}</td>}
                        {showSmaCols && (
                          <td className="py-3.5 px-6 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row["Price > SMA"] === '✅' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                              {row["Price > SMA"]}
                            </span>
                          </td>
                        )}
                        {strictReturnFilter && returnKeys.map(key => (
                          <td key={key} className={`py-3.5 px-6 text-center text-xs ${row[key] === '✅' ? 'text-green-400 font-bold' : row[key] === '❌' ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                            {row[key] !== null && row[key] !== undefined ? row[key] : '-'}
                          </td>
                        ))}
                        {strictVolFilter && volKeys.map(key => (
                          <td key={key} className={`py-3.5 px-6 text-center text-xs ${row[key] === '✅' ? 'text-green-400 font-bold' : row[key] === '❌' ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                            {row[key] !== null && row[key] !== undefined ? row[key] : '-'}
                          </td>
                        ))}
                        {strictHistoryFilter && historyKeys.map(key => (
                          <td key={key} className={`py-3.5 px-6 text-center text-xs ${row[key] === '✅' ? 'text-green-400 font-bold' : row[key] === '❌' ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                            {row[key] !== null && row[key] !== undefined ? row[key] : '-'}
                          </td>
                        ))}
                        <td className="py-3.5 px-6 text-center">
                          <button
                            onClick={() => handleTickerClick(row.Ticker)}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1 mx-auto transition-colors cursor-pointer"
                          >
                            <span>分析 K 線</span>
                            <ChevronRight size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-gray-950/20 border border-dashed border-gray-800 rounded-3xl p-12 text-center flex flex-col items-center justify-center flex-1">
              <FileSpreadsheet size={48} className="text-gray-700 mb-4" />
              <h3 className="text-gray-400 font-bold mb-1">尚未執行任何策略篩選</h3>
              <p className="text-gray-600 text-sm max-w-sm">
                請在左側面板選擇目標股票產生方式、配置篩選條件，然後點擊「開始統一搜尋🚀」獲取最新量化報表。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Ticker Detail Modal (TradingView Chart + Catalyst Stock News) */}
      {selectedTicker && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity">
          <div className="bg-gray-950 border border-gray-800 rounded-3xl w-full max-w-6xl max-h-[95vh] overflow-y-auto flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-6 border-b border-gray-900 bg-gray-950">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center space-x-3">
                  <span className="text-indigo-400 bg-indigo-500/10 px-3 py-0.5 rounded-xl">{selectedTicker}</span>
                  <span>個股技術線圖與催化劑資訊</span>
                </h3>
              </div>
              <button
                onClick={() => setSelectedTicker(null)}
                className="text-gray-500 hover:text-white p-2 rounded-xl hover:bg-gray-900 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {isChartLoading ? (
                <div className="w-full h-96 flex items-center justify-center flex-col space-y-3 text-gray-500">
                  <span className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></span>
                  <p className="text-xs">加載 K 線圖與市場深度數據中...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left: TV interactive chart */}
                  <div className="lg:col-span-2 space-y-3">
                    <TradingViewChart data={chartData} smaWindow={smaWindow} showSma={showSmaCols} />
                  </div>

                  {/* Right: Info and News Catalyst */}
                  <div className="lg:col-span-1 space-y-6 bg-gray-900/40 border border-gray-800 p-6 rounded-2xl">
                    {/* Stock news */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-1.5">
                        <TrendingUp size={12} className="text-indigo-400" />
                        <span>📰 最近催化劑 (Catalyst News Top 3)</span>
                      </h4>
                      <div className="divide-y divide-gray-800/80 space-y-4">
                        {deepDiveData?.news && deepDiveData.news.length > 0 ? (
                          deepDiveData.news.map((item: any, idx: number) => (
                            <div key={idx} className="pt-4 first:pt-0 space-y-1.5">
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 hover:underline leading-snug block"
                              >
                                {item.title}
                              </a>
                              <div className="flex justify-between text-[10px] text-gray-600 font-medium">
                                <span>來源: {item.site || '未知'}</span>
                                <span>發布: {item.publishedDate?.split(' ')[0]}</span>
                              </div>
                              <p className="text-xs text-gray-400 line-clamp-3 leading-normal">
                                {item.text}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-gray-500">查無此標的近期之新聞催化劑。</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default HistoricalScanner;
