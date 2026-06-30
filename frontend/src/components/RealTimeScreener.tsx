import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  RefreshCw,
  Trash2,
  Bell,
  Sliders,
  Volume2,
  ShieldAlert,
  Clock,
  X,
  Newspaper,
  TrendingUp
} from 'lucide-react';

interface RealTimeScreenerProps {
  apiKey: string;
  BASE_URL: string;
}

// ─── Reusable filter row component (used 7× in Settings tab) ───────────────
interface FilterToggleRowProps {
  title: string;
  description: string;
  isActive: boolean;
  onToggle: (val: boolean) => void;
  isFirst?: boolean;
  children: React.ReactNode;
}

const FilterToggleRow: React.FC<FilterToggleRowProps> = ({
  title, description, isActive, onToggle, isFirst = false, children
}) => (
  <div className={`flex flex-col lg:flex-row lg:items-center lg:justify-between ${isFirst ? 'pt-4 first:pt-0' : 'pt-6'} gap-4`}>
    <div className="space-y-1 max-w-md text-left">
      <span className="font-bold text-sm text-white block">{title}</span>
      <span className="text-[11px] text-gray-500 block">{description}</span>
    </div>
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex bg-gray-900 border border-gray-800 p-0.5 rounded-xl text-xs">
        <button
          onClick={() => onToggle(true)}
          className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${isActive ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
        >
          🔥 加入篩選
        </button>
        <button
          onClick={() => onToggle(false)}
          className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${!isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}
        >
          👁️ 僅顯示不篩選
        </button>
      </div>
      {children}
    </div>
  </div>
);
// ────────────────────────────────────────────────────────────────────────────

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

export const RealTimeScreener: React.FC<RealTimeScreenerProps> = ({ apiKey, BASE_URL }) => {
  // Session status
  const [session, setSession] = useState<string>('closed');
  const [estTime, setEstTime] = useState<string>('');

  const [hasStarted, setHasStarted] = useState<boolean>(false);
  const [activeSubTab, setActiveSubTab] = useState<'dashboard' | 'settings'>('dashboard');
  const [showSubSidebar, setShowSubSidebar] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_showSubSidebar');
    return saved !== null ? saved === 'true' : true;
  });

  // Auto-refresh config
  const [autoRefreshMins, setAutoRefreshMins] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_autoRefreshMins');
    return saved ? Number(saved) : 1;
  });
  const [recentMinsWindow, setRecentMinsWindow] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_recentMinsWindow');
    return saved ? Number(saved) : 5;
  });
  const [watchlistExpiryMins, setWatchlistExpiryMins] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_watchlistExpiryMins');
    return saved ? Number(saved) : 15;
  });

  // Filters
  const [minGap, setMinGap] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_minGap');
    return saved ? Number(saved) : 0.0;
  });
  const [minGainer, setMinGainer] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_minGainer');
    return saved ? Number(saved) : 5.0;
  });
  const [minIntraday, setMinIntraday] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_minIntraday');
    return saved ? Number(saved) : 0.0;
  });
  const [minIntervalPct, setMinIntervalPct] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_minIntervalPct');
    return saved ? Number(saved) : 0.0;
  });
  const [minMktCap, setMinMktCap] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_minMktCap');
    return saved ? Number(saved) : 0.0;
  });
  const [maxMktCap, setMaxMktCap] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_maxMktCap');
    return saved ? Number(saved) : 5000.0;
  });
  const [minFloat, setMinFloat] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_minFloat');
    return saved ? Number(saved) : 0.0;
  });
  const [maxFloat, setMaxFloat] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_maxFloat');
    return saved ? Number(saved) : 500.0;
  });
  const [minPrice, setMinPrice] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_minPrice');
    return saved ? Number(saved) : 0.0;
  });
  const [maxPrice, setMaxPrice] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_maxPrice');
    return saved ? Number(saved) : 1000.0;
  });
  const [strictFilter, setStrictFilter] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_strictFilter');
    return saved !== null ? saved === 'true' : true;
  });
  const [enableAlerts, setEnableAlerts] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_enableAlerts');
    return saved !== null ? saved === 'true' : false;
  });

  // Filter Toggles (Active / Display only)
  const [filterGap, setFilterGap] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_filterGap');
    return saved !== null ? saved === 'true' : true;
  });
  const [filterGainer, setFilterGainer] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_filterGainer');
    return saved !== null ? saved === 'true' : true;
  });
  const [filterIntraday, setFilterIntraday] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_filterIntraday');
    return saved !== null ? saved === 'true' : true;
  });
  const [filterInterval, setFilterInterval] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_filterInterval');
    return saved !== null ? saved === 'true' : true;
  });
  const [filterMktCap, setFilterMktCap] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_filterMktCap');
    return saved !== null ? saved === 'true' : true;
  });
  const [filterFloat, setFilterFloat] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_filterFloat');
    return saved !== null ? saved === 'true' : true;
  });
  const [filterPrice, setFilterPrice] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_filterPrice');
    return saved !== null ? saved === 'true' : true;
  });

  // API states
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // News Modal State
  const [selectedNewsTicker, setSelectedNewsTicker] = useState<string | null>(null);
  const [deepDiveData, setDeepDiveData] = useState<any>(null);
  const [isNewsLoading, setIsNewsLoading] = useState<boolean>(false);

  const handleOpenNews = async (ticker: string) => {
    setSelectedNewsTicker(ticker);
    setIsNewsLoading(true);
    setDeepDiveData(null);
    try {
      const response = await axios.get(`${BASE_URL}/api/stocks/${ticker}/deep-dive?provider=FMP&api_key=${apiKey}`);
      setDeepDiveData(response.data);
    } catch (err) {
      console.error('Failed to fetch news:', err);
    } finally {
      setIsNewsLoading(false);
    }
  };

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



  // Primary data fetching — calls /api/screener/tick (batch-quote ring buffer architecture)
  const handleFetchRadarData = async (isBackground: boolean = false) => {
    if (!isBackground) setIsLoading(true);
    setErrorMsg('');

    const payload = {
      fmp_api_key: apiKey,
      auto_refresh_mins: autoRefreshMins,
      recent_mins_window: recentMinsWindow,
      watchlist_expiry_mins: watchlistExpiryMins,
      min_gap: minGap,
      min_gainer: minGainer,
      min_intraday: minIntraday,
      min_interval_pct: minIntervalPct,
      min_mc_m: minMktCap,
      max_mc_m: maxMktCap,
      min_float_m: minFloat,
      max_float_m: maxFloat,
      min_price: minPrice,
      max_price: maxPrice,
      filter_price: filterPrice,
      filter_gap: filterGap,
      filter_gainer: filterGainer,
      filter_intraday: filterIntraday,
      filter_interval: filterInterval,
      filter_mc: filterMktCap,
      filter_float: filterFloat,
      strict_filter: false,
      watchlist: watchlistRef.current
    };

    try {
      const response = await axios.post(`${BASE_URL}/api/screener/tick`, payload);
      setResults(response.data.results);
      setWatchlist(response.data.watchlist);
      setFetchTime(new Date().toLocaleTimeString());

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

  // Persist settings to localStorage
  useEffect(() => {
    localStorage.setItem('RTS_autoRefreshMins', autoRefreshMins.toString());
    localStorage.setItem('RTS_recentMinsWindow', recentMinsWindow.toString());
    localStorage.setItem('RTS_watchlistExpiryMins', watchlistExpiryMins.toString());
    localStorage.setItem('RTS_showSubSidebar', showSubSidebar.toString());
  }, [autoRefreshMins, recentMinsWindow, watchlistExpiryMins, showSubSidebar]);

  useEffect(() => {
    localStorage.setItem('RTS_minGap', minGap.toString());
    localStorage.setItem('RTS_minGainer', minGainer.toString());
    localStorage.setItem('RTS_minIntraday', minIntraday.toString());
    localStorage.setItem('RTS_minIntervalPct', minIntervalPct.toString());
    localStorage.setItem('RTS_minMktCap', minMktCap.toString());
    localStorage.setItem('RTS_maxMktCap', maxMktCap.toString());
    localStorage.setItem('RTS_minFloat', minFloat.toString());
    localStorage.setItem('RTS_maxFloat', maxFloat.toString());
    localStorage.setItem('RTS_minPrice', minPrice.toString());
    localStorage.setItem('RTS_maxPrice', maxPrice.toString());
    localStorage.setItem('RTS_strictFilter', strictFilter.toString());
    localStorage.setItem('RTS_enableAlerts', enableAlerts.toString());

    localStorage.setItem('RTS_filterGap', filterGap.toString());
    localStorage.setItem('RTS_filterGainer', filterGainer.toString());
    localStorage.setItem('RTS_filterIntraday', filterIntraday.toString());
    localStorage.setItem('RTS_filterInterval', filterInterval.toString());
    localStorage.setItem('RTS_filterMktCap', filterMktCap.toString());
    localStorage.setItem('RTS_filterFloat', filterFloat.toString());
    localStorage.setItem('RTS_filterPrice', filterPrice.toString());
  }, [
    minGap, minGainer, minIntraday, minIntervalPct, minMktCap, maxMktCap, minFloat, maxFloat, minPrice, maxPrice, strictFilter, enableAlerts,
    filterGap, filterGainer, filterIntraday, filterInterval, filterMktCap, filterFloat, filterPrice
  ]);

  // Trigger permission request on enable
  useEffect(() => {
    if (enableAlerts && "Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
      Notification.requestPermission();
    }
  }, [enableAlerts]);

  // Keep latest handler in ref to prevent stale closure in setInterval
  const latestFetchRadarData = useRef(handleFetchRadarData);
  useEffect(() => {
    latestFetchRadarData.current = handleFetchRadarData;
  });

  // Handle auto-refresh interval (5-second tick)
  useEffect(() => {
    // 5-second polling interval for batch-quote updates
    const activeInterval = setInterval(async () => {
      if (!hasStarted) return;

      // Update session status (for UI display only)
      try {
        const res = await axios.get(`${BASE_URL}/api/session`);
        setSession(res.data.session);
        setEstTime(res.data.est_time);
      } catch (e) {
        console.error("Session fetch failed", e);
      }

      // Trigger 5-second tick update
      await latestFetchRadarData.current(true);
    }, 5000);

    return () => clearInterval(activeInterval);
  }, [autoRefreshMins, apiKey, watchlistExpiryMins, hasStarted]);

  const handleManualClick = async () => {
    setHasStarted(true);
    await handleFetchRadarData(false);
  };

  // Clean watchlist trigger
  const handleClearWatchlist = () => {
    setWatchlist({});
  };

  // Local/Client-side filtering logic
  const processedResults = results.map(row => {
    const gapVal = row["Gap (%)"] ?? 0;
    const gainerVal = row["Gainer (%)"] ?? 0;
    const intradayVal = row["開盤到目前漲幅 (%)"] ?? 0;

    // Find the dynamic key for N minutes interval return
    const intervalKey = Object.keys(row).find(k => k.startsWith("最近") && k.endsWith("最大漲幅 (%)")) || `最近${recentMinsWindow}分鐘最大漲幅 (%)`;
    const intervalVal = row[intervalKey] ?? 0;

    const mcVal = row["Market Cap (M)"] ?? 0;
    const floatVal = row["Float (M)"] ?? 0;
    const priceVal = row["Price"] ?? 0;

    const condGap = filterGap ? (gapVal >= minGap) : true;
    const condGainer = filterGainer ? (gainerVal >= minGainer) : true;
    const condIntraday = filterIntraday ? (intradayVal >= minIntraday) : true;
    const condInterval = filterInterval ? (intervalVal >= minIntervalPct) : true;

    let condMc = true;
    if (filterMktCap) {
      if (minMktCap > 0) condMc = condMc && (mcVal >= minMktCap);
      if (maxMktCap > 0) condMc = condMc && (mcVal <= maxMktCap);
    }

    let condFloat = true;
    if (filterFloat) {
      if (minFloat > 0) condFloat = condFloat && (floatVal >= minFloat);
      if (maxFloat > 0) condFloat = condFloat && (floatVal <= maxFloat);
    }

    let condPrice = true;
    if (filterPrice) {
      if (minPrice > 0) condPrice = condPrice && (priceVal >= minPrice);
      if (maxPrice > 0) condPrice = condPrice && (priceVal <= maxPrice);
    }

    const isPassed = condGap && condGainer && condIntraday && condInterval && condMc && condFloat && condPrice;

    return {
      ...row,
      isLocalPassed: isPassed,
      // Overwrite static display signal to match local state
      "達標 Signal": isPassed ? "✅" : "❌",
      intervalKey
    };
  });

  const filteredResults = processedResults.filter(row => {
    if (strictFilter) {
      return row.isLocalPassed;
    }
    return true;
  });

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-gray-900 text-gray-100 p-8">
      {/* Header with market status badge */}
      <div className="flex justify-between items-center mb-6">
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

      {/* Sub tabs selector */}
      <div className="flex justify-between items-center border-b border-gray-800 mb-6">
        <div className="flex space-x-4">
          <button
            onClick={() => setActiveSubTab('dashboard')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all duration-200 cursor-pointer ${activeSubTab === 'dashboard'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
          >
            📡 雷達監控主面板 (Dashboard)
          </button>
          <button
            onClick={() => setActiveSubTab('settings')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all duration-200 cursor-pointer ${activeSubTab === 'settings'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
          >
            ⚙️ 篩選與過濾設定 (Settings)
          </button>
        </div>

        {/* Toggle sub sidebar button */}
        <button
          onClick={() => setShowSubSidebar(prev => !prev)}
          className="pb-3 text-xs font-semibold text-gray-400 hover:text-white transition-all cursor-pointer flex items-center space-x-1.5"
        >
          <Sliders size={12} className={showSubSidebar ? 'text-indigo-400' : 'text-gray-500'} />
          <span>{showSubSidebar ? '隱藏控制欄' : '顯示控制欄'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left Control Column */}
        {showSubSidebar && (
          <div className="xl:col-span-1 bg-gray-950/40 p-6 rounded-2xl border border-gray-800 space-y-6 flex flex-col justify-between max-h-[85vh] overflow-y-auto animate-in slide-in-from-left duration-200">
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-2 mb-3">
                  <Sliders size={14} className="text-indigo-400" />
                  <span>監控狀態與控制</span>
                </h3>

                <div className="space-y-3 bg-gray-900/50 p-4 rounded-xl border border-gray-800 text-xs text-left">
                  <div className="flex justify-between">
                    <span className="text-gray-500">更新頻率</span>
                    <span className="font-semibold text-white">{autoRefreshMins} 分鐘</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">計算區間</span>
                    <span className="font-semibold text-white">{recentMinsWindow} 分鐘</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-500">觀察池效期</span>
                    <span className="font-semibold text-white">{watchlistExpiryMins} 分鐘</span>
                  </div>
                  <div className="border-t border-gray-800 my-2 pt-2">
                    <span className="text-gray-500 block mb-1">啟用篩選狀態</span>
                    <div className="flex flex-wrap gap-1">
                      {filterGap && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">跳空</span>}
                      {filterGainer && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">即時漲</span>}
                      {filterIntraday && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">開盤漲</span>}
                      {filterInterval && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">波動</span>}
                      {filterMktCap && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">市值</span>}
                      {filterFloat && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">流通</span>}
                      {filterPrice && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">股價</span>}
                      {!filterGap && !filterGainer && !filterIntraday && !filterInterval && !filterMktCap && !filterFloat && !filterPrice && (
                        <span className="text-amber-400 text-[10px]">無任何篩選條件 (僅顯示)</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Toggles */}
              <div className="space-y-3 pt-4 border-t border-gray-800/80 text-left">
                <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={strictFilter} onChange={(e) => setStrictFilter(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                  <span>僅顯示達標標的 (隱藏未過關)</span>
                </label>
                <label className="flex items-center space-x-2 text-sm font-medium text-indigo-400 cursor-pointer">
                  <input type="checkbox" checked={enableAlerts} onChange={(e) => setEnableAlerts(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                  <div className="flex items-center space-x-1.5">
                    <Bell size={14} className="animate-bounce" />
                    <span>啟用桌面通知與警示聲</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="space-y-3 pt-6 border-t border-gray-800/80">
              {activeSubTab === 'dashboard' ? (
                <div className="flex flex-col space-y-2">
                  {!hasStarted ? (
                    <button
                      onClick={handleManualClick}
                      disabled={isLoading}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/40 text-white rounded-xl py-3 px-4 font-semibold text-sm shadow-lg shadow-indigo-600/35 transition-colors duration-150 flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      {isLoading ? (
                        <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      ) : (
                        <>
                          <RefreshCw size={16} />
                          <span>開始雷達掃描 (啟動自動更新)</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="flex space-x-2">
                      <button
                        onClick={handleManualClick}
                        disabled={isLoading}
                        className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-xl py-3 px-4 font-semibold text-xs shadow-lg transition-colors duration-150 flex items-center justify-center space-x-2 cursor-pointer"
                      >
                        {isLoading ? (
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        ) : (
                          <>
                            <RefreshCw size={14} />
                            <span>強制更新</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => setHasStarted(false)}
                        className="w-full bg-red-600 hover:bg-red-500 text-white rounded-xl py-3 px-4 font-semibold text-xs shadow-lg shadow-red-600/30 transition-colors duration-150 flex items-center justify-center space-x-2 cursor-pointer"
                      >
                        停止雷達掃描
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setActiveSubTab('dashboard')}
                  className="w-full bg-gray-800 hover:bg-gray-700 text-white rounded-xl py-3 px-4 font-semibold text-sm transition-colors duration-150 flex items-center justify-center space-x-2 cursor-pointer border border-gray-700"
                >
                  <span>返回監控面板</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Right Content Area */}
        <div className={`${showSubSidebar ? 'xl:col-span-3' : 'xl:col-span-4'} space-y-8 flex flex-col min-h-[85vh] transition-all duration-300`}>
          {activeSubTab === 'dashboard' ? (
            <>
              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-sm text-left">
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
                  <div className="flex items-center space-x-4">
                    {fetchTime && (
                      <span className="text-xs text-gray-500 font-semibold flex items-center space-x-1">
                        <Clock size={12} />
                        <span>資料更新時間: {fetchTime}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto flex-1 max-h-[42vh] overflow-y-auto">
                  {results.length > 0 ? (
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-gray-900/40 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase">
                          <th className="py-4 px-6">股票代碼</th>
                          <th className="py-4 px-6 text-right">現價</th>
                          <th className="py-4 px-6 text-right">開盤跳空 (Gap)</th>
                          <th className="py-4 px-6 text-right">今日漲幅</th>
                          <th className="py-4 px-6 text-right">開盤後漲幅</th>
                          <th className="py-4 px-6 text-right">最近 {recentMinsWindow} 分鐘最大漲幅</th>
                          <th className="py-4 px-6 text-right">成交量</th>
                          <th className="py-4 px-6 text-right">市值</th>
                          <th className="py-4 px-6 text-right">流通量</th>
                          <th className="py-4 px-6 text-center">達標</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/80">
                        {filteredResults.length > 0 ? (
                          filteredResults.map((row, idx) => {
                            const intervalKey = row.intervalKey || `最近${recentMinsWindow}分鐘最大漲幅 (%)`;
                            return (
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
                                  {row[intervalKey]}%
                                </td>
                                <td className="py-3.5 px-6 text-right font-medium text-gray-300">
                                  {row["Volume"] ? row["Volume"].toLocaleString() : 'N/A'}
                                </td>
                                <td className="py-3.5 px-6 text-right text-gray-400">{row["Market Cap (M)"] ? `${row["Market Cap (M)"]}M` : 'N/A'}</td>
                                <td className="py-3.5 px-6 text-right text-gray-400">{row["Float (M)"] ? `${row["Float (M)"]}M` : 'N/A'}</td>
                                <td className="py-3.5 px-6 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row["達標 Signal"] === '✅' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                    {row["達標 Signal"]}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={9} className="py-12 text-center text-gray-500 font-medium">
                              目前沒有任何股票符合您的篩選閥值條件。請放寬左側的過濾參數。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-12 text-center text-gray-600">
                      <ShieldAlert className="mx-auto mb-2 text-gray-700" size={32} />
                      <span>
                        {!hasStarted
                          ? '請點擊左側「手動更新雷達」開始載入即時監控數據。'
                          : '目前雷達內無監控資料，請確認您的 API 金鑰。'}
                      </span>
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
                        <tr className="bg-gray-900/40 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase whitespace-nowrap">
                          <th className="py-4 px-4">股票代碼</th>
                          <th className="py-4 px-4 text-right">觸發價格</th>
                          <th className="py-4 px-4 text-right">今日漲幅</th>
                          <th className="py-4 px-4 text-right">開盤後漲幅</th>
                          <th className="py-4 px-4 text-right">觸發漲幅</th>
                          <th className="py-4 px-4 text-right">成交量</th>
                          <th className="py-4 px-4 text-right">市值</th>
                          <th className="py-4 px-4 text-right">流通量</th>
                          <th className="py-4 px-4 text-center">觸發時間</th>
                          <th className="py-4 px-4 text-center">追蹤時長</th>
                          <th className="py-4 px-4 text-right">回檔幅</th>
                          <th className="py-4 px-4 text-center">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/80">
                        {Object.entries(watchlist).map(([ticker, info]: [string, any]) => {
                          const triggerTime = new Date(info.trigger_time);
                          const elapsedSecs = Math.floor((new Date().getTime() - triggerTime.getTime()) / 1000);
                          const elapsedMins = Math.floor(elapsedSecs / 60);
                          const elapsedSecsRemain = elapsedSecs % 60;
                          const elapsedStr = `${elapsedMins}分${elapsedSecsRemain}秒`;
                          const currentPrice = info.current_price || info.trigger_price;
                          const maxPrice = Math.max(info.max_price_since_trigger, currentPrice);
                          const pullbackPct = maxPrice > 0 ? ((currentPrice / maxPrice - 1) * 100) : 0.0;
                          const gainerClass = info.current_gainer >= 0 ? "text-green-400" : "text-red-400";
                          const intradayClass = info.current_intraday >= 0 ? "text-green-400" : "text-red-400";
                          return (
                            <tr key={ticker} className="hover:bg-gray-800/20 transition-colors whitespace-nowrap">
                              <td className="py-3.5 px-4 font-bold text-white tracking-wide">{ticker}</td>
                              <td className="py-3.5 px-4 text-right font-semibold text-gray-100">${info.trigger_price}</td>
                              <td className={`py-3.5 px-4 text-right font-medium ${gainerClass}`}>
                                {info.current_gainer > 0 ? '+' : ''}{info.current_gainer?.toFixed(2)}%
                              </td>
                              <td className={`py-3.5 px-4 text-right font-medium ${intradayClass}`}>
                                {info.current_intraday > 0 ? '+' : ''}{info.current_intraday?.toFixed(2)}%
                              </td>
                              <td className="py-3.5 px-4 text-right font-medium text-green-400">+{info.trigger_pct?.toFixed(2)}%</td>
                              <td className="py-3.5 px-4 text-right text-gray-300">{info.volume ? info.volume.toLocaleString() : 'N/A'}</td>
                              <td className="py-3.5 px-4 text-right font-bold text-white">{info.mc_m > 0 ? `${info.mc_m.toFixed(2)}M` : 'N/A'}</td>
                              <td className="py-3.5 px-4 text-right text-gray-300">{info.float_m > 0 ? `${info.float_m.toFixed(2)}M` : 'N/A'}</td>
                              <td className="py-3.5 px-4 text-center text-gray-400">{triggerTime.toLocaleTimeString()}</td>
                              <td className="py-3.5 px-4 text-center text-gray-400 font-medium">{elapsedStr}</td>
                              <td className="py-3.5 px-4 text-right font-bold text-red-400">
                                {pullbackPct === 0 ? '0.00' : pullbackPct.toFixed(2)}%
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <button
                                  onClick={() => handleOpenNews(ticker)}
                                  className="bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1 transition-colors cursor-pointer mx-auto"
                                  title="查看新聞"
                                >
                                  <Newspaper size={14} />
                                  <span>News</span>
                                </button>
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
            </>
          ) : (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {/* Settings Card 1: Basic Config */}
              <div className="bg-gray-950/40 border border-gray-800 rounded-3xl p-6 shadow-xl space-y-6 text-left">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                    <Sliders size={18} className="text-indigo-400" />
                    <span>⚙️ 基礎與自動整理配置</span>
                  </h3>
                  <p className="text-gray-400 text-xs mt-1">設定 API 請求頻率與歷史 K 線加載方式，調整觀察池保留時間。</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-400">Top Gainers 名單更新頻率 (分鐘)</label>
                    <NumericInput
                      value={autoRefreshMins}
                      onChange={setAutoRefreshMins}
                      min={1}
                      className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                    <p className="text-[10px] text-gray-500">定義背景更新 Top Gainers 名單的週期。前端每 5 秒固定拉取即時股價。</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-400">最近漲幅計算區間 (分鐘)</label>
                    <NumericInput
                      value={recentMinsWindow}
                      onChange={setRecentMinsWindow}
                      min={1}
                      className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                    <p className="text-[10px] text-gray-500">定義計算最近波動的最大漲幅區間。</p>
                  </div>



                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-400">觀察池保留時間 (分鐘)</label>
                    <NumericInput
                      value={watchlistExpiryMins}
                      onChange={setWatchlistExpiryMins}
                      min={1}
                      className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                    <p className="text-[10px] text-gray-500">股票觸發達標後，在拉回觀察池中的保留期限。</p>
                  </div>
                </div>


              </div>

              {/* Settings Card 2: Threshold Filters */}
              <div className="bg-gray-950/40 border border-gray-800 rounded-3xl p-6 shadow-xl space-y-6 text-left">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                    <Sliders size={18} className="text-indigo-400" />
                    <span>⚡ 閥值篩選條件設定 (Threshold Filter Settings)</span>
                  </h3>
                  <p className="text-gray-400 text-xs mt-1">決定哪些技術與基本面指標要加入嚴格篩選過濾，哪些僅作數據呈現。</p>
                </div>

                <div className="divide-y divide-gray-800/60 space-y-6">

                  {/* ── Gap Filter ──────────────────────────────────── */}
                  <FilterToggleRow
                    title="開盤跳空幅 (Gap %)"
                    description="相較於前一日收盤價的開盤跳空漲幅百分比。"
                    isActive={filterGap}
                    onToggle={setFilterGap}
                    isFirst
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500">閥值:</span>
                      <NumericInput step={0.1} value={minGap} onChange={setMinGap} className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-white w-24 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                  </FilterToggleRow>

                  {/* ── Gainer Filter ────────────────────────────────── */}
                  <FilterToggleRow
                    title="即時累計漲幅 (Gainer %)"
                    description="相較於前一日收盤價的當前即時最大累計漲幅。"
                    isActive={filterGainer}
                    onToggle={setFilterGainer}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500">閥值:</span>
                      <NumericInput step={0.1} value={minGainer} onChange={setMinGainer} className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-white w-24 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                  </FilterToggleRow>

                  {/* ── Intraday Filter ──────────────────────────────── */}
                  <FilterToggleRow
                    title="開盤到當前漲幅 (%)"
                    description="從今日開盤價到當前價格的漲幅波動。"
                    isActive={filterIntraday}
                    onToggle={setFilterIntraday}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500">閥值:</span>
                      <NumericInput step={0.1} value={minIntraday} onChange={setMinIntraday} className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-white w-24 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                  </FilterToggleRow>

                  {/* ── Interval Filter ──────────────────────────────── */}
                  <FilterToggleRow
                    title={`最近 ${recentMinsWindow} 分鐘最大波動漲幅 (%)`}
                    description={`在設定的最近 ${recentMinsWindow} 分鐘內的最高波動上漲幅度。`}
                    isActive={filterInterval}
                    onToggle={setFilterInterval}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500">閥值:</span>
                      <NumericInput step={0.1} value={minIntervalPct} onChange={setMinIntervalPct} className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-1.5 text-xs text-white w-24 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-xs text-gray-500">%</span>
                    </div>
                  </FilterToggleRow>

                  {/* ── Market Cap Filter ────────────────────────────── */}
                  <FilterToggleRow
                    title="市值範圍 (Market Cap, M)"
                    description="設定篩選公司的市值區間（以百萬美元 M 為單位）。"
                    isActive={filterMktCap}
                    onToggle={setFilterMktCap}
                  >
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-gray-500">最低:</span>
                      <NumericInput value={minMktCap} onChange={setMinMktCap} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-gray-500">M</span>
                      <span className="text-gray-500 pl-2">最高:</span>
                      <NumericInput value={maxMktCap} onChange={setMaxMktCap} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-gray-500">M</span>
                    </div>
                  </FilterToggleRow>

                  {/* ── Float Filter ─────────────────────────────────── */}
                  <FilterToggleRow
                    title="流通股數範圍 (Float, M)"
                    description="設定篩選公司的流通股數量區間（以百萬股 M 為單位）。"
                    isActive={filterFloat}
                    onToggle={setFilterFloat}
                  >
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-gray-500">最低:</span>
                      <NumericInput value={minFloat} onChange={setMinFloat} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-gray-500">M</span>
                      <span className="text-gray-500 pl-2">最高:</span>
                      <NumericInput value={maxFloat} onChange={setMaxFloat} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-gray-500">M</span>
                    </div>
                  </FilterToggleRow>

                  {/* ── Price Filter ─────────────────────────────────── */}
                  <FilterToggleRow
                    title="股票價格範圍 ($)"
                    description="過濾標的的股價上下限區間。"
                    isActive={filterPrice}
                    onToggle={setFilterPrice}
                  >
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-gray-500">最低:</span>
                      <NumericInput step={0.01} value={minPrice} onChange={setMinPrice} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-gray-500">$</span>
                      <span className="text-gray-500 pl-2">最高:</span>
                      <NumericInput step={0.01} value={maxPrice} onChange={setMaxPrice} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-gray-500">$</span>
                    </div>
                  </FilterToggleRow>

                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* News Modal */}
      {selectedNewsTicker && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity">
          <div className="bg-gray-950 border border-gray-800 rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-y-auto flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-6 border-b border-gray-900 bg-gray-950 sticky top-0 z-10">
              <h3 className="text-xl font-bold text-white flex items-center space-x-3">
                <span className="text-indigo-400 bg-indigo-500/10 px-3 py-0.5 rounded-xl">{selectedNewsTicker}</span>
                <span className="flex items-center space-x-2"><TrendingUp size={18} className="text-indigo-400" /> <span>最近催化劑 (Catalyst News Top 3)</span></span>
              </h3>
              <button
                onClick={() => setSelectedNewsTicker(null)}
                className="text-gray-500 hover:text-white p-2 rounded-xl hover:bg-gray-900 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              {isNewsLoading ? (
                <div className="w-full flex items-center justify-center py-12 space-x-3 text-gray-500">
                  <span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></span>
                  <p className="text-sm">加載新聞中...</p>
                </div>
              ) : (
                <div className="space-y-4">
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
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RealTimeScreener;
