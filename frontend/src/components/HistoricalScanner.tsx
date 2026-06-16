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
  const [volMin] = useState<number>(1.0);
  const [volMax] = useState<number>(500);
  const [sector, setSector] = useState<string>('');
  const [industry] = useState<string>('');
  const [limit, setLimit] = useState<number>(100);

  // Indicators
  const [smaWindow, setSmaWindow] = useState<number>(50);
  const [showSmaCols, setShowSmaCols] = useState<boolean>(true);

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
  const [extEnableAdv] = useState<boolean>(false);
  const [extAdvNDays] = useState<number>(1);
  const [extAdvRetDir] = useState<'漲' | '跌'>('跌');
  const [extAdvRetType] = useState<'大於' | '小於'>('大於');
  const [extAdvRetVal] = useState<number>(0.0);
  const [extAdvStrict] = useState<boolean>(false);

  // Fake Breakout
  const [fbMinGap, setFbMinGap] = useState<number>(30.0);
  const [fbMinVolM] = useState<number>(10.0);
  const [fbMinPrevClose] = useState<number>(1.0);
  const [fbMinShadowRatio, setFbMinShadowRatio] = useState<number>(60.0);
  const [fbTimeRangeMin] = useState<number>(0);
  const [fbTimeRangeMax] = useState<number>(12);

  // QullaMaggie Breakout
  const [qmDays, setQmDays] = useState<number>(63);
  const [qmMinRet, setQmMinRet] = useState<number>(30.0);

  const [strictHistoryFilter, setStrictHistoryFilter] = useState<boolean>(false);

  // Volatility
  const [volMultiplier, setVolMultiplier] = useState<number>(10.0);
  const [strictVolFilter, setStrictVolFilter] = useState<boolean>(false);

  // UI state
  const [isLoading, setIsLoading] = useState<boolean>(false);
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

    if (dataSource === 'FMP' && !apiKey) {
      setErrorMsg('請先在側邊欄輸入 FMP API Key！');
      setIsLoading(false);
      return;
    }

    if (inputMethod !== 'FMP 伺服器端進階篩選' && finalTickers.length === 0) {
      setErrorMsg('請輸入至少一檔股票代碼或上傳 CSV！');
      setIsLoading(false);
      return;
    }

    // Build payload
    const payload = {
      data_source: dataSource,
      fmp_api_key: apiKey || null,
      input_method: inputMethod,
      tickers: finalTickers,
      fmp_server_params: inputMethod === 'FMP 伺服器端進階篩選' ? {
        marketCapMoreThan: mktCapMin * 1000000,
        marketCapLowerThan: mktCapMax * 1000000,
        priceMoreThan: priceMin,
        priceLowerThan: priceMax,
        volumeMoreThan: volMin * 1000000,
        volumeLowerThan: volMax * 1000000,
        sector: sector || null,
        industry: industry || null,
        limit: limit
      } : null,
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
      } : {
        qm_days: qmDays,
        qm_min_ret: qmMinRet
      },
      strict_history_filter: strictHistoryFilter,
      vol_multiplier: volMultiplier,
      strict_vol_filter: strictVolFilter
    };

    try {
      const response = await axios.post(`${BASE_URL}/api/scan`, payload);
      setResults(response.data.results);
      if (response.data.results.length === 0) {
        setErrorMsg('掃描完成，未發現符合篩選條件的標的，請放寬條件。');
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || '請求後端 API 錯誤，請確認後端是否正常啟動。');
    } finally {
      setIsLoading(false);
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

      // 2. Fetch deep dive news and quote
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

  // Export results to CSV
  const handleExportCsv = () => {
    if (results.length === 0) return;
    const headers = Object.keys(results[0]).join(',');
    const rows = results.map(row => 
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
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <span>📈 歷史策略掃描</span>
            <span className="text-xs bg-indigo-500/20 text-indigo-400 font-semibold px-2 py-0.5 rounded-full">Historical Scanner</span>
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            設定策略過濾器，從大範圍或特定的股票清單中篩選出潛在的高動能標的。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left Side: Filters Column */}
        <div className="xl:col-span-1 bg-gray-950/40 p-6 rounded-2xl border border-gray-800 space-y-6 max-h-[85vh] overflow-y-auto">
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
                    <input type="number" value={mktCapMin} onChange={(e) => setMktCapMin(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">最高市值 (M)</label>
                    <input type="number" value={mktCapMax} onChange={(e) => setMktCapMax(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">股價大於 ($)</label>
                    <input type="number" value={priceMin} onChange={(e) => setPriceMin(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block">股價小於 ($)</label>
                    <input type="number" value={priceMax} onChange={(e) => setPriceMax(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
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
                  <input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
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
              <input 
                type="number" 
                value={smaWindow} 
                onChange={(e) => setSmaWindow(Number(e.target.value))}
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
              <div>
                <label className="text-xs text-gray-500">單日最低漲幅 (%)</label>
                <input type="number" value={min1dReturn} onChange={(e) => setMin1dReturn(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 text-sm text-white" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500 block">區間天數 (N)</label>
                  <input type="number" value={nDaysReturn} onChange={(e) => setNDaysReturn(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 block">N日最低漲幅 (%)</label>
                  <input type="number" value={minNdReturn} onChange={(e) => setMinNdReturn(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1 text-xs text-white" />
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
              </select>
            </div>

            {/* Strategy params */}
            {strategySelect === '1.Extended Short' && (
              <div className="space-y-3 bg-gray-900/40 p-3 rounded-lg border border-gray-800 text-xs">
                <div>
                  <label className="text-gray-500 block">曾單日總漲幅大於 (%)</label>
                  <input type="number" value={extMinDailyRet} onChange={(e) => setExtMinDailyRet(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div>
                  <label className="text-gray-500 block">曾單日實體大於 (%)</label>
                  <input type="number" value={extMinBodyRet} onChange={(e) => setExtMinBodyRet(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500">時間範圍起 (月)</label>
                    <input type="number" value={extTimeRangeMin} onChange={(e) => setExtTimeRangeMin(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">時間範圍止 (月)</label>
                    <input type="number" value={extTimeRangeMax} onChange={(e) => setExtTimeRangeMax(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                  </div>
                </div>
              </div>
            )}

            {strategySelect === '2.Fake Breakout Short' && (
              <div className="space-y-3 bg-gray-900/40 p-3 rounded-lg border border-gray-800 text-xs">
                <div>
                  <label className="text-gray-500 block">跳空大於 (%)</label>
                  <input type="number" value={fbMinGap} onChange={(e) => setFbMinGap(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div>
                  <label className="text-gray-500 block">上影線比例大於 (%)</label>
                  <input type="number" value={fbMinShadowRatio} onChange={(e) => setFbMinShadowRatio(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
              </div>
            )}

            {strategySelect === '3.QullaMaggie Breakout' && (
              <div className="space-y-3 bg-gray-900/40 p-3 rounded-lg border border-gray-800 text-xs">
                <div>
                  <label className="text-gray-500 block">期間天數區間</label>
                  <select value={qmDays} onChange={(e) => setQmDays(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white">
                    <option value={21}>1個月 (21日)</option>
                    <option value={63}>3個月 (63日)</option>
                    <option value={126}>6個月 (126日)</option>
                  </select>
                </div>
                <div>
                  <label className="text-gray-500 block">期間漲幅大於 (%)</label>
                  <input type="number" value={qmMinRet} onChange={(e) => setQmMinRet(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
              </div>
            )}

            <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
              <input 
                type="checkbox" 
                checked={strictHistoryFilter}
                onChange={(e) => setStrictHistoryFilter(e.target.checked)}
                className="text-indigo-600 focus:ring-indigo-500 rounded" 
              />
              <span>啟用策略暴漲/假突破獨立篩選</span>
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

          {/* Submit Button */}
          <button
            onClick={handleStartScan}
            disabled={isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/40 text-white rounded-xl py-3 px-4 font-semibold text-sm shadow-lg shadow-indigo-600/35 transition-colors duration-150 flex items-center justify-center space-x-2 cursor-pointer"
          >
            {isLoading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <>
                <Play size={16} />
                <span>開始統一搜尋 🚀</span>
              </>
            )}
          </button>
        </div>

        {/* Right Side: Data View Column */}
        <div className="xl:col-span-3 space-y-6 flex flex-col min-h-[85vh]">
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
                  找到 {results.length} 檔股票符合條件
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
                      onSaveScan(results);
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
                      {showSmaCols && <th className="py-4 px-6 text-right">SMA ({smaWindow})</th>}
                      {showSmaCols && <th className="py-4 px-6 text-center">價 &gt; SMA</th>}
                      {results[0] && results[0]["1日漲幅(%)"] !== undefined && <th className="py-4 px-6 text-right">1日漲幅</th>}
                      {results[0] && results[0]["歷史暴漲日期"] !== undefined && <th className="py-4 px-6 text-center">策略標記</th>}
                      <th className="py-4 px-6 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/80">
                    {results.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-800/30 transition-colors">
                        <td className="py-3.5 px-6 font-bold text-white tracking-wide">{row.Ticker}</td>
                        <td className="py-3.5 px-6 text-gray-300 font-medium truncate max-w-[150px]">{row.Name}</td>
                        <td className="py-3.5 px-6 text-gray-400">{row.Sector}</td>
                        <td className="py-3.5 px-6 text-gray-400">{row["Market Cap"]}</td>
                        <td className="py-3.5 px-6 text-right font-semibold text-gray-100">${row.Close}</td>
                        {showSmaCols && <td className="py-3.5 px-6 text-right text-gray-400">${row[`SMA_${smaWindow}`]}</td>}
                        {showSmaCols && (
                          <td className="py-3.5 px-6 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row["Price > SMA"] === '✅' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                              {row["Price > SMA"]}
                            </span>
                          </td>
                        )}
                        {row["1日漲幅(%)"] !== undefined && (
                          <td className="py-3.5 px-6 text-right font-medium text-green-400">
                            +{row["1日漲幅(%)"]}%
                          </td>
                        )}
                        {row["歷史暴漲日期"] !== undefined && (
                          <td className="py-3.5 px-6 text-center text-xs text-gray-400">
                            暴漲: {row["歷史暴漲日期"]} ({row["歷史暴漲幅度(%)"]}%)
                          </td>
                        )}
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
                    {/* Live Metric */}
                    {deepDiveData?.aftermarket_quote && Object.keys(deepDiveData.aftermarket_quote).length > 0 && (
                      <div className="bg-gray-900/60 p-4 rounded-xl border border-gray-800/80">
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
                          <Activity size={12} className="text-orange-400" />
                          <span>🌙 盤後報價 (After-Market)</span>
                        </h4>
                        <div className="flex justify-between items-end">
                          <span className="text-2xl font-bold text-white">${deepDiveData.aftermarket_quote.price}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${deepDiveData.aftermarket_quote.change >= 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                            {deepDiveData.aftermarket_quote.change >= 0 ? '+' : ''}{deepDiveData.aftermarket_quote.change} ({deepDiveData.aftermarket_quote.changesPercentage}%)
                          </span>
                        </div>
                      </div>
                    )}

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
