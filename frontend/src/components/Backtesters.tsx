import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { createChart, ColorType, LineSeries, LineStyle } from 'lightweight-charts';
import { 
  FlaskConical, 
  BrainCircuit, 
  Play, 
  TrendingUp, 
  DollarSign, 
  Sliders, 
  ArrowRightLeft
} from 'lucide-react';

interface BacktestersProps {
  apiKey: string;
  scannedTickers: string[];
  BASE_URL: string;
  initialTab?: 'vector' | 'backtrader';
}

// Sub-component for rendering line chart equity curve using lightweight-charts
const EquityCurveChart: React.FC<{ data: any[]; showBnh?: boolean }> = ({ data, showBnh = false }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const strategySeriesRef = useRef<any>(null);
  const bnhSeriesRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#111827' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#1F2937' },
        horzLines: { color: '#1F2937' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 360,
      timeScale: {
        borderColor: '#374151',
      },
    });

    const strategySeries = chart.addSeries(LineSeries, {
      color: '#10B981',
      lineWidth: 3,
      title: '策略收益 (%)',
    });

    strategySeriesRef.current = strategySeries;
    chartRef.current = chart;

    if (showBnh) {
      const bnhSeries = chart.addSeries(LineSeries, {
        color: '#6B7280',
        lineWidth: 1,
        title: '買入持有 (B&H %)',
        lineStyle: LineStyle.Dashed,
      });
      bnhSeriesRef.current = bnhSeries;
    }

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [showBnh]);

  useEffect(() => {
    if (!strategySeriesRef.current || !data || data.length === 0) return;

    const stratData = data.map(d => ({
      time: d.time,
      value: d.strategy
    }));
    strategySeriesRef.current.setData(stratData);

    if (showBnh && bnhSeriesRef.current) {
      const bnhData = data
        .filter(d => d.bnh !== undefined)
        .map(d => ({
          time: d.time,
          value: d.bnh
        }));
      bnhSeriesRef.current.setData(bnhData);
    }

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [data, showBnh]);

  return (
    <div className="w-full bg-gray-950/40 p-4 rounded-2xl border border-gray-800 shadow-lg">
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
};

export const Backtesters: React.FC<BacktestersProps> = ({ apiKey, scannedTickers, BASE_URL, initialTab }) => {
  const [activeSubTab, setActiveSubTab] = useState<'vector' | 'backtrader'>(initialTab || 'vector');

  // Common UI State
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [metrics, setMetrics] = useState<any>(null);
  const [equityData, setEquityData] = useState<any[]>([]);
  const [tradeLogs, setTradeLogs] = useState<any[]>([]);

  // Sync with prop when clicking on sidebar tabs
  useEffect(() => {
    if (initialTab) {
      setActiveSubTab(initialTab);
      setMetrics(null);
      setEquityData([]);
      setTradeLogs([]);
      setErrorMsg('');
    }
  }, [initialTab]);

  // Vectorized Lab Configs
  const [vecDataSource, setVecDataSource] = useState<string>('FMP');
  const [vecTickersInput, setVecTickersInput] = useState<string>('AAPL');
  const [vecPeriod, setVecPeriod] = useState<string>('5y');
  const [vecStrategy, setVecStrategy] = useState<string>('極端暴漲當沖放空 (Gap-Up Momentum Short)');
  const [vecCond1, setVecCond1] = useState<number>(90.0);
  const [vecCond2, setVecCond2] = useState<number>(70.0);
  const [vecTp, setVecTp] = useState<number>(15.0);
  const [vecSl, setVecSl] = useState<number>(5.0);
  const [vecSmaFast, setVecSmaFast] = useState<number>(20);
  const [vecSmaSlow, setVecSmaSlow] = useState<number>(60);

  // Backtrader Configs
  const [btDataSource, setBtDataSource] = useState<string>('FMP');
  const [btTickersInput, setBtTickersInput] = useState<string>('AAPL');
  const [btPeriod, setBtPeriod] = useState<string>('5y');
  const [btStartingCash, setBtStartingCash] = useState<number>(100000);
  const [btCommType, setBtCommType] = useState<'percent' | 'fixed'>('percent');
  const [btCommVal, setBtCommVal] = useState<number>(0.1); // 0.1% or $5
  const [btStrategy, setBtStrategy] = useState<string>('A. 雙均線波段做多 (含動態止盈止損)');
  const [btStakeMode, setBtStakeMode] = useState<string>('shares');
  const [btStakeVal, setBtStakeVal] = useState<number>(100);
  const [btSmaFast, setBtSmaFast] = useState<number>(20);
  const [btSmaSlow, setBtSmaSlow] = useState<number>(60);
  const [btCond1, setBtCond1] = useState<number>(90.0);
  const [btCond2, setBtCond2] = useState<number>(70.0);
  const [btTp, setBtTp] = useState<number>(15.0);
  const [btSl, setBtSl] = useState<number>(5.0);
  const [btMaxHold, setBtMaxHold] = useState<number>(1);

  // Auto-populate inputs when scanned tickers change
  useEffect(() => {
    if (scannedTickers && scannedTickers.length > 0) {
      const uniqueTickers = Array.from(new Set(scannedTickers));
      const tickersStr = uniqueTickers.slice(0, 5).join(', ');
      setVecTickersInput(tickersStr);
      setBtTickersInput(tickersStr);
    }
  }, [scannedTickers]);

  // Trigger Vectorized Backtest
  const runVectorizedBacktest = async () => {
    setIsLoading(true);
    setErrorMsg('');
    setMetrics(null);
    setEquityData([]);
    setTradeLogs([]);

    const tickers = vecTickersInput
      .replace(/\n/g, ',')
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0);

    if (tickers.length === 0) {
      setErrorMsg('請提供至少一檔股票代號進行回測！');
      setIsLoading(false);
      return;
    }

    if (vecDataSource === 'FMP' && !apiKey) {
      setErrorMsg('使用 FMP 數據源需配置 FMP API 金鑰！');
      setIsLoading(false);
      return;
    }

    const payload = {
      tickers,
      data_source: vecDataSource,
      fmp_api_key: apiKey || null,
      period: vecPeriod,
      strategy_choice: vecStrategy,
      cond1_pct: vecCond1,
      cond2_pct: vecCond2,
      tp_pct: vecTp,
      sl_pct: vecSl,
      sma_fast: vecSmaFast,
      sma_slow: vecSmaSlow
    };

    try {
      const res = await axios.post(`${BASE_URL}/api/backtest/vectorized`, payload);
      setMetrics(res.data.metrics);
      setEquityData(res.data.equity);
      setTradeLogs(res.data.logs);
      if (res.data.logs.length === 0) {
        setErrorMsg('回測完成，但在該期間與參數配置下，未觸發任何進場訊號。');
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || '向量回測計算錯誤。');
    } finally {
      setIsLoading(false);
    }
  };

  // Trigger Backtrader simulation
  const runBacktraderBacktest = async () => {
    setIsLoading(true);
    setErrorMsg('');
    setMetrics(null);
    setEquityData([]);
    setTradeLogs([]);

    const tickers = btTickersInput
      .replace(/\n/g, ',')
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0);

    if (tickers.length === 0) {
      setErrorMsg('請提供至少一檔股票代號！');
      setIsLoading(false);
      return;
    }

    if (btDataSource === 'FMP' && !apiKey) {
      setErrorMsg('大腦引擎使用 FMP 數據源需要提供 FMP API 金鑰！');
      setIsLoading(false);
      return;
    }

    const payload = {
      tickers,
      data_source: btDataSource,
      fmp_api_key: apiKey || null,
      period: btPeriod,
      starting_cash: btStartingCash,
      is_fixed_comm: btCommType === 'fixed',
      commission_val: btCommType === 'percent' ? btCommVal / 100.0 : btCommVal,
      strategy: btStrategy,
      stake_mode: btStakeMode,
      stake_val: btStakeVal,
      sma_fast: btSmaFast,
      sma_slow: btSmaSlow,
      cond1_pct: btCond1,
      cond2_pct: btCond2,
      tp_pct: btTp,
      sl_pct: btSl,
      max_hold: btMaxHold
    };

    try {
      const res = await axios.post(`${BASE_URL}/api/backtest/backtrader`, payload);
      setMetrics(res.data.metrics);
      setEquityData(res.data.equity);
      setTradeLogs(res.data.logs);
      if (res.data.logs.length === 0) {
        setErrorMsg('模擬完成。未撮合出任何交易，請確認資料範圍或放寬進場門檻。');
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || '大腦模擬器計算發生錯誤。如果是5分鐘精確回測，請確認您的 API 金鑰具備分鐘線權限。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-gray-900 text-gray-100 p-8">
      {/* Title */}
      <div className="mb-6 flex justify-between items-end border-b border-gray-800 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <span>🧪 量化回測平台</span>
            <span className="text-xs bg-indigo-500/20 text-indigo-400 font-semibold px-2 py-0.5 rounded-full">Backtesting Suite</span>
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            提供向量化 (Vectorized) 矩陣快速演算與 Backtrader 事件驅動 (Event-driven) 真實撮合模擬。
          </p>
        </div>

        {/* Sub-navigation tabs */}
        <div className="bg-gray-950 p-1.5 rounded-2xl flex space-x-1 border border-gray-800/80">
          <button
            onClick={() => {
              setActiveSubTab('vector');
              setMetrics(null);
              setEquityData([]);
              setTradeLogs([]);
              setErrorMsg('');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'vector' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            矩陣快速回測
          </button>
          <button
            onClick={() => {
              setActiveSubTab('backtrader');
              setMetrics(null);
              setEquityData([]);
              setTradeLogs([]);
              setErrorMsg('');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'backtrader' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Backtrader 精確模擬
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left Filter Config Panel */}
        <div className="xl:col-span-1 bg-gray-950/40 p-6 rounded-2xl border border-gray-800 space-y-6 max-h-[85vh] overflow-y-auto">
          {activeSubTab === 'vector' ? (
            /* Vectorized Form */
            <div className="space-y-5">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2">
                <Sliders size={14} className="text-indigo-400" />
                <span>回測設定 (Vectorized)</span>
              </h3>

              <div className="space-y-1">
                <label className="text-xs text-gray-500">數據來源</label>
                <select value={vecDataSource} onChange={(e) => setVecDataSource(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white">
                  <option value="FMP">FMP API</option>
                  <option value="Yahoo Finance">Yahoo Finance</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500">股票代碼 (多檔以逗號分隔)</label>
                <textarea 
                  value={vecTickersInput} 
                  onChange={(e) => setVecTickersInput(e.target.value)} 
                  className="w-full h-16 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500" 
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500">歷史回測期間</label>
                <select value={vecPeriod} onChange={(e) => setVecPeriod(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white">
                  <option value="1y">1年</option>
                  <option value="2y">2年</option>
                  <option value="5y">5年</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500">回測策略模型</label>
                <select value={vecStrategy} onChange={(e) => setVecStrategy(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white">
                  <option value="極端暴漲當沖放空 (Gap-Up Momentum Short)">極端暴漲當沖放空 (Short)</option>
                  <option value="雙均線黃金交叉做多 (Dual SMA Crossover)">雙均線做多 (Long)</option>
                </select>
              </div>

              {/* Strategy Parameters */}
              {vecStrategy.includes('極端') ? (
                <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-800 text-xs">
                  <h4 className="font-bold text-gray-400">當沖放空條件</h4>
                  <div>
                    <label className="text-gray-500 block">前日單日總漲幅 &gt; (%)</label>
                    <input type="number" value={vecCond1} onChange={(e) => setVecCond1(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                  </div>
                  <div>
                    <label className="text-gray-500 block">前日實體K棒漲幅 &gt; (%)</label>
                    <input type="number" value={vecCond2} onChange={(e) => setVecCond2(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500">止盈目標 %</label>
                      <input type="number" value={vecTp} onChange={(e) => setVecTp(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-white" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">止損限制 %</label>
                      <input type="number" value={vecSl} onChange={(e) => setVecSl(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-white" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-800 text-xs">
                  <h4 className="font-bold text-gray-400">均線參數</h4>
                  <div>
                    <label className="text-gray-500 block">快線周期 (Fast SMA)</label>
                    <input type="number" value={vecSmaFast} onChange={(e) => setVecSmaFast(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                  </div>
                  <div>
                    <label className="text-gray-500 block">慢線周期 (Slow SMA)</label>
                    <input type="number" value={vecSmaSlow} onChange={(e) => setVecSmaSlow(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                  </div>
                </div>
              )}

              <button
                onClick={runVectorizedBacktest}
                disabled={isLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/40 text-white rounded-xl py-3 px-4 font-semibold text-sm shadow-lg shadow-indigo-600/35 transition-colors duration-150 flex items-center justify-center space-x-2 cursor-pointer"
              >
                {isLoading ? (
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <>
                    <Play size={16} />
                    <span>運行矩陣快速回測</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            /* Backtrader Form */
            <div className="space-y-5">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2">
                <Sliders size={14} className="text-indigo-400" />
                <span>模擬設定 (Backtrader)</span>
              </h3>

              <div className="space-y-1">
                <label className="text-xs text-gray-500">歷史報價數據源</label>
                <select value={btDataSource} onChange={(e) => setBtDataSource(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white">
                  <option value="FMP">FMP API</option>
                  <option value="Yahoo Finance">Yahoo Finance</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500">回測標的代碼</label>
                <textarea 
                  value={btTickersInput} 
                  onChange={(e) => setBtTickersInput(e.target.value)} 
                  className="w-full h-16 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500" 
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500">歷史區間</label>
                <select value={btPeriod} onChange={(e) => setBtPeriod(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white">
                  <option value="1y">1年</option>
                  <option value="2y">2年</option>
                  <option value="5y">5年</option>
                </select>
              </div>

              <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-800 text-xs space-y-2">
                <h4 className="font-bold text-gray-400 flex items-center space-x-1">
                  <DollarSign size={12} className="text-emerald-400" />
                  <span>券商交易環境</span>
                </h4>
                <div>
                  <label className="text-gray-500 block">初始模擬資金 ($)</label>
                  <input type="number" value={btStartingCash} onChange={(e) => setBtStartingCash(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
                <div>
                  <label className="text-gray-500 block">收費模式</label>
                  <div className="flex space-x-4 mt-1">
                    <label className="flex items-center space-x-1.5 cursor-pointer">
                      <input type="radio" checked={btCommType === 'percent'} onChange={() => setBtCommType('percent')} />
                      <span>比例 %</span>
                    </label>
                    <label className="flex items-center space-x-1.5 cursor-pointer">
                      <input type="radio" checked={btCommType === 'fixed'} onChange={() => setBtCommType('fixed')} />
                      <span>固定 $</span>
                    </label>
                  </div>
                </div>
                <div>
                  <label className="text-gray-500 block">手續費額度</label>
                  <input type="number" value={btCommVal} onChange={(e) => setBtCommVal(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500">搭載核心大腦策略</label>
                <select value={btStrategy} onChange={(e) => setBtStrategy(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-white">
                  <option value="A. 雙均線波段做多 (含動態止盈止損)">A. 雙均線波段做多</option>
                  <option value="B. 極端暴漲當沖放空 (嚴格隔日收盤回補)">B. 極端暴漲日線當沖放空</option>
                  <option value="C. 暴漲隔日 5min 限價放空 (Precision 5min Backtest)">C. 暴漲隔日 5分鐘限價當沖</option>
                </select>
              </div>

              {/* Backtrader parameters */}
              <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-800 text-xs">
                <h4 className="font-bold text-gray-400">大腦策略參數配置</h4>
                <div className="space-y-2">
                  <div>
                    <label className="text-gray-500 block">每次下單配置</label>
                    <div className="flex space-x-4 mt-1">
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input type="radio" checked={btStakeMode === 'shares'} onChange={() => setBtStakeMode('shares')} />
                        <span>股數</span>
                      </label>
                      <label className="flex items-center space-x-1.5 cursor-pointer">
                        <input type="radio" checked={btStakeMode === 'cash'} onChange={() => setBtStakeMode('cash')} />
                        <span>金額 $</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="text-gray-500 block">進場下單大小</label>
                    <input type="number" value={btStakeVal} onChange={(e) => setBtStakeVal(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
                  </div>
                </div>

                {btStrategy.includes('A.') && (
                  <div className="space-y-2 pt-2 border-t border-gray-800">
                    <div>
                      <label className="text-[10px] text-gray-500">快線天數</label>
                      <input type="number" value={btSmaFast} onChange={(e) => setBtSmaFast(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-white" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">慢線天數</label>
                      <input type="number" value={btSmaSlow} onChange={(e) => setBtSmaSlow(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-white" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">止盈 %</label>
                        <input type="number" value={btTp} onChange={(e) => setBtTp(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">止損 %</label>
                        <input type="number" value={btSl} onChange={(e) => setBtSl(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                    </div>
                  </div>
                )}

                {btStrategy.includes('B.') && (
                  <div className="space-y-2 pt-2 border-t border-gray-800">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">前日漲幅 &gt;</label>
                        <input type="number" value={btCond1} onChange={(e) => setBtCond1(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">前日實體 &gt;</label>
                        <input type="number" value={btCond2} onChange={(e) => setBtCond2(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">做空止盈 %</label>
                        <input type="number" value={btTp} onChange={(e) => setBtTp(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">做空止損 %</label>
                        <input type="number" value={btSl} onChange={(e) => setBtSl(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block">最大持倉天數</label>
                      <input type="number" value={btMaxHold} onChange={(e) => setBtMaxHold(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 text-white" />
                    </div>
                  </div>
                )}

                {btStrategy.includes('C.') && (
                  <div className="space-y-2 pt-2 border-t border-gray-800">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">暴漲日漲幅</label>
                        <input type="number" value={btCond1} onChange={(e) => setBtCond1(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">暴漲日實體</label>
                        <input type="number" value={btCond2} onChange={(e) => setBtCond2(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">5min止盈 %</label>
                        <input type="number" value={btTp} onChange={(e) => setBtTp(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">5min止損 %</label>
                        <input type="number" value={btSl} onChange={(e) => setBtSl(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-white" />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={runBacktraderBacktest}
                disabled={isLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/40 text-white rounded-xl py-3 px-4 font-semibold text-sm shadow-lg shadow-indigo-600/35 transition-colors duration-150 flex items-center justify-center space-x-2 cursor-pointer"
              >
                {isLoading ? (
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <>
                    <BrainCircuit size={16} />
                    <span>運行 Backtrader 模擬</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Right Outputs Panel */}
        <div className="xl:col-span-3 space-y-6 flex flex-col min-h-[85vh]">
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-sm">
              {errorMsg}
            </div>
          )}

          {metrics ? (
            <div className="space-y-6 flex flex-col flex-1">
              {/* Metrics cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-950/40 border border-gray-800 p-4 rounded-2xl">
                  <span className="text-xs font-semibold text-gray-500 uppercase">累積總報酬率</span>
                  <p className={`text-2xl font-black mt-1 ${metrics.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {metrics.total_return_pct >= 0 ? '+' : ''}{metrics.total_return_pct}%
                  </p>
                </div>
                <div className="bg-gray-950/40 border border-gray-800 p-4 rounded-2xl">
                  <span className="text-xs font-semibold text-gray-500 uppercase">最大資金回撤 (MDD)</span>
                  <p className="text-2xl font-black mt-1 text-red-400">
                    {metrics.mdd_pct}%
                  </p>
                </div>
                <div className="bg-gray-950/40 border border-gray-800 p-4 rounded-2xl">
                  <span className="text-xs font-semibold text-gray-500 uppercase">交易趟數與勝率</span>
                  <p className="text-2xl font-black mt-1 text-indigo-400">
                    {metrics.total_trades} 趟 ({metrics.win_rate}% 勝)
                  </p>
                </div>
                <div className="bg-gray-950/40 border border-gray-800 p-4 rounded-2xl">
                  <span className="text-xs font-semibold text-gray-500 uppercase">夏普比率 (Sharpe)</span>
                  <p className="text-2xl font-black mt-1 text-orange-400">
                    {metrics.sharpe}
                  </p>
                </div>
              </div>

              {/* Equity chart */}
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-gray-400 flex items-center space-x-1.5">
                  <TrendingUp size={16} className="text-indigo-400" />
                  <span>資金累積增長曲線 (Equity Curve)</span>
                </h4>
                <EquityCurveChart data={equityData} showBnh={activeSubTab === 'vector'} />
              </div>

              {/* Trade Logs Table */}
              <div className="bg-gray-950/40 border border-gray-800 rounded-3xl overflow-hidden flex flex-col flex-1 shadow-lg">
                <div className="p-4 border-b border-gray-800 bg-gray-950/60 flex items-center space-x-2">
                  <ArrowRightLeft size={16} className="text-indigo-400" />
                  <h4 className="font-bold text-white text-sm">執行交易撮合明細 (Trade Execution Logs)</h4>
                </div>

                <div className="overflow-x-auto flex-1 max-h-[35vh] overflow-y-auto">
                  {tradeLogs.length > 0 ? (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-900/60 border-b border-gray-800 font-semibold text-gray-400 uppercase">
                          <th className="py-3 px-5">標的</th>
                          {tradeLogs[0]["date"] && <th className="py-3 px-5">觸發日期</th>}
                          {tradeLogs[0]["進場時間"] && <th className="py-3 px-5">進場時間</th>}
                          {tradeLogs[0]["出場時間"] && <th className="py-3 px-5">出場時間</th>}
                          {tradeLogs[0]["動作"] && <th className="py-3 px-5">部位動作</th>}
                          {tradeLogs[0]["進場價"] && <th className="py-3 px-5 text-right">進場價</th>}
                          {tradeLogs[0]["出場價"] && <th className="py-3 px-5 text-right">出場價</th>}
                          {tradeLogs[0]["淨獲利(USD)"] !== undefined && <th className="py-3 px-5 text-right">淨損益</th>}
                          {tradeLogs[0]["毛利率(%)"] !== undefined && <th className="py-3 px-5 text-right">毛利率</th>}
                          {tradeLogs[0]["當沖獲利(%)"] !== undefined && <th className="py-3 px-5 text-right">獲利 %</th>}
                          {tradeLogs[0]["出場備註"] && <th className="py-3 px-5">出場狀態</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/80">
                        {tradeLogs.map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-800/10 transition-colors">
                            <td className="py-2.5 px-5 font-bold text-white tracking-wide">{row["標的"] || row["Ticker"]}</td>
                            {row["date"] && <td className="py-2.5 px-5 text-gray-400">{row["date"]}</td>}
                            {row["進場時間"] && <td className="py-2.5 px-5 text-gray-400">{row["進場時間"]}</td>}
                            {row["出場時間"] && <td className="py-2.5 px-5 text-gray-400">{row["出場時間"]}</td>}
                            {row["動作"] && (
                              <td className={`py-2.5 px-5 font-semibold ${row["動作"].includes('做多') ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {row["動作"]}
                              </td>
                            )}
                            {row["進場價"] !== undefined && <td className="py-2.5 px-5 text-right text-gray-300">${row["進場價"]}</td>}
                            {row["出場價"] !== undefined && <td className="py-2.5 px-5 text-right text-gray-300">${row["出場價"]}</td>}
                            {row["淨獲利(USD)"] !== undefined && (
                              <td className={`py-2.5 px-5 text-right font-semibold ${row["淨獲利(USD)"] >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                ${row["淨獲利(USD)"]}
                              </td>
                            )}
                            {row["毛利率(%)"] !== undefined && (
                              <td className={`py-2.5 px-5 text-right font-semibold ${row["毛利率(%)"] >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {row["毛利率(%)"]}%
                              </td>
                            )}
                            {row["當沖獲利(%)"] !== undefined && (
                              <td className={`py-2.5 px-5 text-right font-semibold ${row["當沖獲利(%)"] >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {row["當沖獲利(%)"]?.toFixed(2)}%
                              </td>
                            )}
                            {row["出場備註"] && <td className="py-2.5 px-5 text-gray-500">{row["出場備註"]}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-8 text-center text-gray-600">無交易撮合日誌。</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-950/20 border border-dashed border-gray-800 rounded-3xl p-12 text-center flex flex-col items-center justify-center flex-1">
              <FlaskConical size={48} className="text-gray-700 mb-4" />
              <h3 className="text-gray-400 font-bold mb-1">尚未執行回測模擬</h3>
              <p className="text-gray-600 text-sm max-w-sm">
                請在左側配置交易標的、設定券商初始資金、交易費率與核心策略參數，點擊啟動按鈕進行量化回測。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default Backtesters;
