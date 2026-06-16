import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  RefreshCw, 
  Trash2, 
  Bell, 
  Sliders, 
  Volume2, 
  ShieldAlert,
  Clock
} from 'lucide-react';

interface RealTimeScreenerProps {
  apiKey: string;
  BASE_URL: string;
}

export const RealTimeScreener: React.FC<RealTimeScreenerProps> = ({ apiKey, BASE_URL }) => {
  // Session status
  const [session, setSession] = useState<string>('closed');
  const [estTime, setEstTime] = useState<string>('');

  // Auto-refresh config
  const [autoRefreshMins, setAutoRefreshMins] = useState<number>(5);
  const [intradayInterval, setIntradayInterval] = useState<string>('Auto (根據更新頻率)');
  const [todayOnly, setTodayOnly] = useState<boolean>(true);
  const [extendedHours, setExtendedHours] = useState<boolean>(true);
  const [watchlistExpiryMins, setWatchlistExpiryMins] = useState<number>(15);

  // Filters
  const [minGap, setMinGap] = useState<number>(0.0);
  const [minGainer, setMinGainer] = useState<number>(5.0);
  const [minIntraday, setMinIntraday] = useState<number>(0.0);
  const [minIntervalPct, setMinIntervalPct] = useState<number>(0.0);
  const [minMktCap, setMinMktCap] = useState<number>(0.0);
  const [maxMktCap, setMaxMktCap] = useState<number>(5000.0);
  const [minFloat, setMinFloat] = useState<number>(0.0);
  const [maxFloat, setMaxFloat] = useState<number>(500.0);
  const [strictFilter, setStrictFilter] = useState<boolean>(true);
  const [enableAlerts, setEnableAlerts] = useState<boolean>(false);

  // API states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [results, setResults] = useState<any[]>([]);
  const [watchlist, setWatchlist] = useState<Record<string, any>>({});
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [fetchTime, setFetchTime] = useState<string>('');

  // Refs to avoid state staleness in interval loop
  const watchlistRef = useRef<any>({});
  watchlistRef.current = watchlist;

  // Web Audio API double-beep
  const playDoubleBeep = () => {
    try {
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playBeep = (delay: number, frequency: number, duration: number) => {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.connect(gain);
        gain.connect(context.destination);
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.2, context.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + delay + duration);
        osc.start(context.currentTime + delay);
        osc.stop(context.currentTime + delay + duration);
      };
      playBeep(0, 880, 0.15);
      playBeep(0.2, 880, 0.15);
    } catch (e) {
      console.log("Audio play error: " + e);
    }
  };

  // Trigger HTML5 Desktop Notification
  const triggerNotification = (tickers: string[]) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("⚡ Stock Screener 達標通知", {
        body: `股票 ${tickers.join(', ')} 滿足您設定的即時篩選條件！`,
        icon: "https://cdn-icons-png.flaticon.com/512/179/179386.png"
      });
    }
  };

  // Fetch session status
  const fetchSession = async () => {
    try {
      const res = await axios.get(`${BASE_URL}/api/session`);
      setSession(res.data.session);
      setEstTime(res.data.est_time);
    } catch (e) {
      console.error("Failed to fetch session", e);
    }
  };

  // Primary data fetching
  const handleFetchRadarData = async (isBackground: boolean = false) => {
    if (!apiKey) {
      setErrorMsg('請先在側邊欄配置 FMP API 金鑰！');
      return;
    }

    if (!isBackground) setIsLoading(true);
    setErrorMsg('');

    const payload = {
      fmp_api_key: apiKey,
      auto_refresh_mins: autoRefreshMins,
      intraday_interval: intradayInterval,
      today_only: todayOnly,
      extended_hours: extendedHours,
      watchlist_expiry_mins: watchlistExpiryMins,
      min_gap: minGap,
      min_gainer: minGainer,
      min_intraday: minIntraday,
      min_interval_pct: minIntervalPct,
      min_mc_m: minMktCap,
      max_mc_m: maxMktCap,
      min_float_m: minFloat,
      max_float_m: maxFloat,
      strict_filter: strictFilter,
      watchlist: watchlistRef.current
    };

    try {
      const response = await axios.post(`${BASE_URL}/api/screener/realtime`, payload);
      setResults(response.data.results);
      setWatchlist(response.data.watchlist);
      setFetchTime(new Date().toLocaleTimeString());

      // Trigger alerts if enabled and newly passed tickers found
      if (enableAlerts && response.data.new_notifications?.length > 0) {
        playDoubleBeep();
        triggerNotification(response.data.new_notifications);
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || '拉取即時雷達數據失敗。請確認金鑰權限或 API 額度。');
    } finally {
      if (!isBackground) setIsLoading(false);
    }
  };

  // Trigger permission request on enable
  useEffect(() => {
    if (enableAlerts && "Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
      Notification.requestPermission();
    }
  }, [enableAlerts]);

  // Handle auto-refresh interval lifecycle
  useEffect(() => {
    fetchSession();
    if (apiKey) {
      handleFetchRadarData();
    }

    // Set auto-refresh interval
    const intervalTime = autoRefreshMins * 60 * 1000;
    const activeInterval = setInterval(() => {
      fetchSession();
      if (apiKey) {
        handleFetchRadarData(true);
      }
    }, intervalTime);

    return () => clearInterval(activeInterval);
  }, [autoRefreshMins, apiKey, intradayInterval, todayOnly, extendedHours, minGap, minGainer, minIntraday, minIntervalPct, minMktCap, maxMktCap, minFloat, maxFloat, strictFilter]);

  // Clean watchlist trigger
  const handleClearWatchlist = () => {
    setWatchlist({});
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-gray-900 text-gray-100 p-8">
      {/* Header with market status badge */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-3">
            <span>⚡ 即時監控篩選 (Top Gainers)</span>
            <span className="text-xs bg-indigo-500/20 text-indigo-400 font-semibold px-2 py-0.5 rounded-full">Real-time Radar</span>
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            即時監控美股盤中最大的暴漲股，配合分鐘K線進行拉回 (Pullback) 幅度追蹤，自動提供買點訊號警示。
          </p>
        </div>
        
        {/* Market status indicator */}
        <div className="flex items-center space-x-2">
          {session === 'regular' ? (
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-md">
              <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-ping"></span>
              <span>🟢 Regular Session {estTime && `(${estTime} EST)`}</span>
            </span>
          ) : session === 'extended' ? (
            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-md">
              <span className="w-2.5 h-2.5 bg-amber-400 rounded-full animate-ping"></span>
              <span>🟠 Extended Session {estTime && `(${estTime} EST)`}</span>
            </span>
          ) : (
            <span className="bg-gray-800 text-gray-400 border border-gray-700 px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-md">
              <span className="w-2.5 h-2.5 bg-gray-500 rounded-full"></span>
              <span>⚪ Market Closed {estTime && `(${estTime} EST)`}</span>
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Filters Column */}
        <div className="xl:col-span-1 bg-gray-950/40 p-6 rounded-2xl border border-gray-800 space-y-6 max-h-[85vh] overflow-y-auto">
          {/* Config */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2">
              <Sliders size={14} className="text-indigo-400" />
              <span>自動整理配置</span>
            </h3>
            
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">更新頻率 (分鐘)</label>
              <input 
                type="number" 
                value={autoRefreshMins}
                onChange={(e) => setAutoRefreshMins(Number(e.target.value))}
                className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" 
                min={1} 
              />
            </div>

            <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-800 text-xs space-y-2.5">
              <h4 className="font-bold text-gray-400">進階 K 線數據拉取參數</h4>
              <div>
                <label className="text-gray-500 block">收盤價級距</label>
                <select value={intradayInterval} onChange={(e) => setIntradayInterval(e.target.value)} className="w-full bg-gray-900 border border-gray-800 rounded mt-1 p-1 text-white">
                  <option value="Auto (根據更新頻率)">Auto (根據更新頻率)</option>
                  <option value="1min">1分鐘線</option>
                  <option value="5min">5分鐘線</option>
                </select>
              </div>
              <label className="flex items-center space-x-2 text-gray-300 cursor-pointer pt-1">
                <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                <span>僅載入今日交易數據</span>
              </label>
              <label className="flex items-center space-x-2 text-gray-300 cursor-pointer">
                <input type="checkbox" checked={extendedHours} onChange={(e) => setExtendedHours(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                <span>包含盤前盤後歷史價格</span>
              </label>
              <div>
                <label className="text-gray-500 block">拉回觀察池保留時間 (分鐘)</label>
                <input type="number" value={watchlistExpiryMins} onChange={(e) => setWatchlistExpiryMins(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded mt-1 p-1 text-white" />
              </div>
            </div>
          </div>

          {/* Value Filters */}
          <div className="space-y-4 pt-4 border-t border-gray-800/80">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">閥值過濾參數</h3>
            <div className="space-y-2.5 text-xs">
              <div>
                <label className="text-gray-500 block">跳空大於 (%)</label>
                <input type="number" value={minGap} onChange={(e) => setMinGap(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
              </div>
              <div>
                <label className="text-gray-500 block">即時累計漲幅大於 (%)</label>
                <input type="number" value={minGainer} onChange={(e) => setMinGainer(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
              </div>
              <div>
                <label className="text-gray-500 block">開盤到當前漲幅大於 (%)</label>
                <input type="number" value={minIntraday} onChange={(e) => setMinIntraday(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
              </div>
              <div>
                <label className="text-gray-500 block">最近幾分鐘最大波動漲幅 (%)</label>
                <input type="number" value={minIntervalPct} onChange={(e) => setMinIntervalPct(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1 mt-1 text-white" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500">最低市值 (M)</label>
                  <input type="number" value={minMktCap} onChange={(e) => setMinMktCap(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">最高市值 (M)</label>
                  <input type="number" value={maxMktCap} onChange={(e) => setMaxMktCap(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-500">最低流通 (M)</label>
                  <input type="number" value={minFloat} onChange={(e) => setMinFloat(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">最高流通 (M)</label>
                  <input type="number" value={maxFloat} onChange={(e) => setMaxFloat(Number(e.target.value))} className="w-full bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-white" />
                </div>
              </div>
            </div>
          </div>

          {/* Trigger Alert configs */}
          <div className="space-y-3 pt-4 border-t border-gray-800/80">
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
              <input type="checkbox" checked={strictFilter} onChange={(e) => setStrictFilter(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
              <span>僅顯示達標標的 (隱藏未過關)</span>
            </label>
            <label className="flex items-center space-x-2 text-sm font-medium text-indigo-400 cursor-pointer">
              <input type="checkbox" checked={enableAlerts} onChange={(e) => setEnableAlerts(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
              <div className="flex items-center space-x-1.5">
                <Bell size={14} className="animate-bounce" />
                <span>啟用桌面通知與警示聲</span>
              </div>
            </label>
          </div>

          <button
            onClick={() => handleFetchRadarData()}
            disabled={isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/40 text-white rounded-xl py-3 px-4 font-semibold text-sm shadow-lg shadow-indigo-600/35 transition-colors duration-150 flex items-center justify-center space-x-2 cursor-pointer"
          >
            {isLoading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <>
                <RefreshCw size={16} />
                <span>手動更新雷達</span>
              </>
            )}
          </button>
        </div>

        {/* Data View Columns */}
        <div className="xl:col-span-3 space-y-8 flex flex-col min-h-[85vh]">
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-sm">
              {errorMsg}
            </div>
          )}

          {/* Real-time Radar Table */}
          <div className="bg-gray-950/40 border border-gray-800 rounded-3xl overflow-hidden flex flex-col flex-1 shadow-xl">
            <div className="flex justify-between items-center p-5 border-b border-gray-800 bg-gray-950/60">
              <div className="flex items-center space-x-2">
                <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-ping"></div>
                <h3 className="font-bold text-white text-base">📡 即時雷達追蹤 (Top Gainer Radar)</h3>
              </div>
              {fetchTime && (
                <span className="text-xs text-gray-500 font-semibold flex items-center space-x-1">
                  <Clock size={12} />
                  <span>資料更新時間: {fetchTime}</span>
                </span>
              )}
            </div>

            <div className="overflow-x-auto flex-1 max-h-[42vh] overflow-y-auto">
              {results.length > 0 ? (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-900/40 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase">
                      <th className="py-4 px-6">股票代碼</th>
                      <th className="py-4 px-6 text-right">現價</th>
                      <th className="py-4 px-6 text-right">開盤跳空 (Gap)</th>
                      <th className="py-4 px-6 text-right">即時漲幅</th>
                      <th className="py-4 px-6 text-right">開盤後漲幅</th>
                      <th className="py-4 px-6 text-right">最近波動</th>
                      <th className="py-4 px-6 text-right">市值</th>
                      <th className="py-4 px-6 text-right">流通量</th>
                      <th className="py-4 px-6 text-center">達標</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/80">
                    {results.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-800/20 transition-colors">
                        <td className="py-3.5 px-6 font-bold text-white tracking-wide">{row.Ticker}</td>
                        <td className="py-3.5 px-6 text-right font-semibold text-gray-100">${row.Price}</td>
                        <td className={`py-3.5 px-6 text-right font-medium ${row["Gap (%)"] >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {row["Gap (%)"] >= 0 ? '+' : ''}{row["Gap (%)"]}%
                        </td>
                        <td className={`py-3.5 px-6 text-right font-medium ${row["Gainer (%)"] >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {row["Gainer (%)"] >= 0 ? '+' : ''}{row["Gainer (%)"]}%
                        </td>
                        <td className={`py-3.5 px-6 text-right font-medium ${row["開盤到目前漲幅 (%)"] >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {row["開盤到目前漲幅 (%)"] >= 0 ? '+' : ''}{row["開盤到目前漲幅 (%)"]}%
                        </td>
                        <td className="py-3.5 px-6 text-right font-medium text-indigo-400">
                          {row[`最近${autoRefreshMins}分鐘最大漲幅 (%)`]}%
                        </td>
                        <td className="py-3.5 px-6 text-right text-gray-400">{row["Market Cap (M)"] ? `${row["Market Cap (M)"]}M` : 'N/A'}</td>
                        <td className="py-3.5 px-6 text-right text-gray-400">{row["Float (M)"] ? `${row["Float (M)"]}M` : 'N/A'}</td>
                        <td className="py-3.5 px-6 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row["達標 Signal"] === '✅' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                            {row["達標 Signal"]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-12 text-center text-gray-600">
                  <ShieldAlert className="mx-auto mb-2 text-gray-700" size={32} />
                  <span>目前雷達內無監控資料，請確認您的 API 金鑰。</span>
                </div>
              )}
            </div>
          </div>

          {/* Active Pullback Watchlist */}
          <div className="bg-gray-950/40 border border-gray-800 rounded-3xl overflow-hidden flex flex-col flex-1 shadow-xl">
            <div className="flex justify-between items-center p-5 border-b border-gray-800 bg-gray-950/60">
              <div className="flex items-center space-x-2">
                <Volume2 size={18} className="text-indigo-400" />
                <h3 className="font-bold text-white text-base">📈 達標活躍觀察池 (Active Pullback Watchlist - 保留 {watchlistExpiryMins} 分鐘)</h3>
              </div>
              {Object.keys(watchlist).length > 0 && (
                <button
                  onClick={handleClearWatchlist}
                  className="text-red-400 hover:text-red-300 text-xs font-semibold flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-red-500/10 bg-red-500/5 hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                  <Trash2 size={12} />
                  <span>清空觀察池</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto flex-1 max-h-[38vh] overflow-y-auto">
              {Object.keys(watchlist).length > 0 ? (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-900/40 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase">
                      <th className="py-4 px-6">股票代碼</th>
                      <th className="py-4 px-6">觸發時間</th>
                      <th className="py-4 px-6">追蹤時長</th>
                      <th className="py-4 px-6 text-right">觸發價</th>
                      <th className="py-4 px-6 text-right">觸發漲幅</th>
                      <th className="py-4 px-6 text-right">回檔幅 (%) (Pullback)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/80">
                    {Object.entries(watchlist).map(([ticker, info]: [string, any]) => {
                      const triggerTime = new Date(info.trigger_time);
                      const elapsedSecs = Math.floor((new Date().getTime() - triggerTime.getTime()) / 1000);
                      const elapsedMins = Math.floor(elapsedSecs / 60);
                      const elapsedSecsRemain = elapsedSecs % 60;
                      const elapsedStr = `${elapsedMins}分${elapsedSecsRemain}秒前`;
                      
                      const currentQuote = results.find(r => r.Ticker === ticker);
                      const currentPrice = currentQuote ? currentQuote.Price : info.trigger_price;
                      const maxPrice = Math.max(info.max_price_since_trigger, currentPrice);
                      const pullbackPct = maxPrice > 0 ? ((currentPrice / maxPrice - 1) * 100) : 0.0;

                      return (
                        <tr key={ticker} className="hover:bg-gray-800/20 transition-colors">
                          <td className="py-3.5 px-6 font-bold text-white tracking-wide">{ticker}</td>
                          <td className="py-3.5 px-6 text-gray-400">{triggerTime.toLocaleTimeString()}</td>
                          <td className="py-3.5 px-6 text-gray-400 font-medium">{elapsedStr}</td>
                          <td className="py-3.5 px-6 text-right font-semibold text-gray-100">${info.trigger_price}</td>
                          <td className="py-3.5 px-6 text-right font-medium text-green-400">+{info.trigger_pct?.toFixed(2)}%</td>
                          <td className="py-3.5 px-6 text-right font-bold text-red-400">
                            {pullbackPct === 0 ? '0.00' : pullbackPct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-12 text-center text-gray-600">
                  <ShieldAlert className="mx-auto mb-2 text-gray-700" size={32} />
                  <span>目前觀察池內尚無達標股票。滿足條件的暴漲股會自動加入此處，供您追蹤買點。</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default RealTimeScreener;
