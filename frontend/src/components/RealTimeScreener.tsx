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
  const [activeSubTab, setActiveSubTab] = useState<'dashboard' | 'custom' | 'settings'>('dashboard');
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
  const [minVolume, setMinVolume] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_minVolume');
    return saved ? Number(saved) : 0;
  });
  const [maxVolume, setMaxVolume] = useState<number>(() => {
    const saved = localStorage.getItem('RTS_maxVolume');
    return saved ? Number(saved) : 0;
  });
  const [filterVolume, setFilterVolume] = useState<boolean>(() => {
    const saved = localStorage.getItem('RTS_filterVolume');
    return saved !== null ? saved === 'true' : false;
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

  // --- Custom Watchlist States ---
  const defaultCustomFilters = {
    minGap: 0.0, filterGap: true,
    minGainer: 5.0, filterGainer: true,
    minIntraday: 0.0, filterIntraday: true,
    minIntervalPct: 0.0, filterInterval: true,
    minMktCap: 0.0, maxMktCap: 5000.0, filterMktCap: true,
    minFloat: 0.0, maxFloat: 500.0, filterFloat: true,
    minVolume: 0, maxVolume: 0, filterVolume: false,
    minPrice: 0.0, maxPrice: 1000.0, filterPrice: true,
    strictFilter: true,
  };

  const [customFilters, setCustomFilters] = useState(() => {
    const saved = localStorage.getItem('RTS_customFilters');
    return saved ? JSON.parse(saved) : defaultCustomFilters;
  });

  const updateCustomFilter = (key: string, value: any) => {
    setCustomFilters((prev: any) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem('RTS_customFilters', JSON.stringify(next));
      return next;
    });
  };

  const [customTickers, setCustomTickers] = useState<string[]>(() => {
    const saved = localStorage.getItem('RTS_customTickers');
    return saved ? JSON.parse(saved) : [];
  });
  const [customResults, setCustomResults] = useState<any[]>([]);



  const customTickersRef = useRef<string[]>([]);
  customTickersRef.current = customTickers;

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
      watchlist: watchlistRef.current,
      custom_tickers: customTickersRef.current
    };

    try {
      const response = await axios.post(`${BASE_URL}/api/screener/tick`, payload);
      setResults(response.data.results);
      if (response.data.custom_results) {
        setCustomResults(response.data.custom_results);
      }
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
    const volumeVal = row["Volume"] ?? 0;

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

    let condVolume = true;
    if (filterVolume) {
      if (minVolume > 0) condVolume = condVolume && (volumeVal >= minVolume * 1_000_000);
      if (maxVolume > 0) condVolume = condVolume && (volumeVal <= maxVolume * 1_000_000);
    }

    let condPrice = true;
    if (filterPrice) {
      if (minPrice > 0) condPrice = condPrice && (priceVal >= minPrice);
      if (maxPrice > 0) condPrice = condPrice && (priceVal <= maxPrice);
    }

    const isPassed = condGap && condGainer && condIntraday && condInterval && condMc && condFloat && condVolume && condPrice;

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

  const processedCustomResults = customResults.map(row => {
    const gapVal = row["Gap (%)"] ?? 0;
    const gainerVal = row["Gainer (%)"] ?? 0;
    const intradayVal = row["開盤到目前漲幅 (%)"] ?? 0;
    const intervalKey = Object.keys(row).find(k => k.startsWith("最近") && k.endsWith("最大漲幅 (%)")) || `最近${recentMinsWindow}分鐘最大漲幅 (%)`;
    const intervalVal = row[intervalKey] ?? 0;
    const mcVal = row["Market Cap (M)"] ?? 0;
    const floatVal = row["Float (M)"] ?? 0;
    const priceVal = row["Price"] ?? 0;
    const volumeVal = row["Volume"] ?? 0;

    const cGap = customFilters.minGap;
    const cFilterGap = customFilters.filterGap;
    const condGap = cFilterGap ? (gapVal >= cGap) : true;

    const cGainer = customFilters.minGainer;
    const cFilterGainer = customFilters.filterGainer;
    const condGainer = cFilterGainer ? (gainerVal >= cGainer) : true;

    const cIntraday = customFilters.minIntraday;
    const cFilterIntraday = customFilters.filterIntraday;
    const condIntraday = cFilterIntraday ? (intradayVal >= cIntraday) : true;

    const cInterval = customFilters.minIntervalPct;
    const cFilterInterval = customFilters.filterInterval;
    const condInterval = cFilterInterval ? (intervalVal >= cInterval) : true;

    const cMinMc = customFilters.minMktCap;
    const cMaxMc = customFilters.maxMktCap;
    const cFilterMc = customFilters.filterMktCap;
    let condMc = true;
    if (cFilterMc) {
      if (cMinMc > 0) condMc = condMc && (mcVal >= cMinMc);
      if (cMaxMc > 0) condMc = condMc && (mcVal <= cMaxMc);
    }

    const cMinFloat = customFilters.minFloat;
    const cMaxFloat = customFilters.maxFloat;
    const cFilterFloat = customFilters.filterFloat;
    let condFloat = true;
    if (cFilterFloat) {
      if (cMinFloat > 0) condFloat = condFloat && (floatVal >= cMinFloat);
      if (cMaxFloat > 0) condFloat = condFloat && (floatVal <= cMaxFloat);
    }

    const cMinVolume = customFilters.minVolume;
    const cMaxVolume = customFilters.maxVolume;
    const cFilterVolume = customFilters.filterVolume;
    let condVolume = true;
    if (cFilterVolume) {
      if (cMinVolume > 0) condVolume = condVolume && (volumeVal >= cMinVolume * 1_000_000);
      if (cMaxVolume > 0) condVolume = condVolume && (volumeVal <= cMaxVolume * 1_000_000);
    }

    const cMinPrice = customFilters.minPrice;
    const cMaxPrice = customFilters.maxPrice;
    const cFilterPrice = customFilters.filterPrice;
    let condPrice = true;
    if (cFilterPrice) {
      if (cMinPrice > 0) condPrice = condPrice && (priceVal >= cMinPrice);
      if (cMaxPrice > 0) condPrice = condPrice && (priceVal <= cMaxPrice);
    }

    const isPassed = condGap && condGainer && condIntraday && condInterval && condMc && condFloat && condVolume && condPrice;

    return {
      ...row,
      isLocalPassed: isPassed,
      "達標 Signal": isPassed ? "✅" : "❌",
      intervalKey
    };
  });

  const filteredCustomResults = processedCustomResults.filter(row => {
    if (customFilters.strictFilter) {
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
            📡 Top Gainers 雷達監控
          </button>
          <button
            onClick={() => setActiveSubTab('custom')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all duration-200 cursor-pointer ${activeSubTab === 'custom'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
          >
            📋 自訂監控 (My Watchlist)
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

                <div className="space-y-4 text-xs text-left">
                  {activeSubTab === 'custom' ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-500">計算區間</span>
                        <span className="font-semibold text-white">{recentMinsWindow} 分鐘</span>
                      </div>
                      <div className="border-t border-gray-800 my-2 pt-2">
                        <span className="text-gray-500 block mb-1">啟用篩選狀態</span>
                        <div className="flex flex-wrap gap-1">
                          {customFilters.filterGap && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">跳空</span>}
                          {customFilters.filterGainer && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">即時漲</span>}
                          {customFilters.filterIntraday && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">開盤漲</span>}
                          {customFilters.filterInterval && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">波動</span>}
                          {customFilters.filterMktCap && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">市值</span>}
                          {customFilters.filterFloat && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">流通</span>}
                          {customFilters.filterPrice && <span className="bg-indigo-500/10 text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-mono">股價</span>}
                          {!customFilters.filterGap && !customFilters.filterGainer && !customFilters.filterIntraday && !customFilters.filterInterval && !customFilters.filterMktCap && !customFilters.filterFloat && !customFilters.filterPrice && (
                            <span className="text-amber-400 text-[10px]">無任何篩選條件 (僅顯示)</span>
                          )}
                        </div>
                      </div>

                      {/* --- ADD Ticker Input Area HERE --- */}
                      <div className="border-t border-gray-800 mt-4 pt-4 space-y-3">
                        <span className="text-gray-500 block mb-1">新增監控標的</span>
                        <div className="flex flex-col space-y-2">
                          <input
                            type="text"
                            id="customTickerInput"
                            placeholder="輸入代碼 (例: AAPL)"
                            className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 uppercase w-full"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const val = e.currentTarget.value.trim().toUpperCase();
                                if (val && !customTickers.includes(val)) {
                                  const next = [...customTickers, val];
                                  setCustomTickers(next);
                                  localStorage.setItem('RTS_customTickers', JSON.stringify(next));
                                  e.currentTarget.value = '';
                                }
                              }
                            }}
                          />
                          <div className="flex space-x-2">
                            <button
                              onClick={() => {
                                const input = document.getElementById('customTickerInput') as HTMLInputElement;
                                const val = input.value.trim().toUpperCase();
                                if (val && !customTickers.includes(val)) {
                                  const next = [...customTickers, val];
                                  setCustomTickers(next);
                                  localStorage.setItem('RTS_customTickers', JSON.stringify(next));
                                  input.value = '';
                                }
                              }}
                              className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-3 py-2 text-xs font-semibold transition-colors cursor-pointer flex-1 text-center shadow-lg shadow-indigo-600/30"
                            >
                              加入監控
                            </button>
                            <button
                              onClick={() => {
                                setCustomTickers([]);
                                localStorage.setItem('RTS_customTickers', JSON.stringify([]));
                              }}
                              className="bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-400 rounded-xl px-3 py-2 text-xs font-semibold transition-colors cursor-pointer text-center"
                            >
                              全部清除
                            </button>
                          </div>
                        </div>

                        {/* Custom Tickers Chips (Flattened) */}
                        {customTickers.length > 0 && (
                          <div className="pt-2 max-h-40 overflow-y-auto">
                            <span className="text-[10px] text-gray-500 block mb-2 font-semibold">已加入名單 ({customTickers.length})</span>
                            <div className="flex flex-wrap gap-1.5">
                              {customTickers.map(t => (
                                <span key={t} className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center space-x-1.5">
                                  <span>{t}</span>
                                  <button 
                                    onClick={() => {
                                      const next = customTickers.filter(x => x !== t);
                                      setCustomTickers(next);
                                      localStorage.setItem('RTS_customTickers', JSON.stringify(next));
                                    }}
                                    className="hover:text-red-400 transition-colors cursor-pointer"
                                  >
                                    &times;
                                  </button>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              </div>

              {/* Quick Toggles */}
              <div className="space-y-3 pt-4 border-t border-gray-800/80 text-left">
                {activeSubTab === 'custom' ? (
                  <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={customFilters.strictFilter} onChange={(e) => updateCustomFilter('strictFilter', e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                    <span>僅顯示達標標的 (隱藏未過關)</span>
                  </label>
                ) : (
                  <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={strictFilter} onChange={(e) => setStrictFilter(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                    <span>僅顯示達標標的 (隱藏未過關)</span>
                  </label>
                )}
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
                                  {row["Volume"] ? `${(row["Volume"] / 1000000).toFixed(2)}M` : 'N/A'}
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
                              <td className="py-3.5 px-4 text-right text-gray-300">{info.volume ? `${(info.volume / 1000000).toFixed(2)}M` : 'N/A'}</td>
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
          ) : activeSubTab === 'custom' ? (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {/* Custom Watchlist Table */}
              <div className="bg-gray-950/40 border border-gray-800 rounded-3xl overflow-hidden flex flex-col shadow-xl">
                <div className="flex justify-between items-center p-5 border-b border-gray-800 bg-gray-950/60">
                  <div className="flex items-center space-x-2">
                    <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full"></div>
                    <h3 className="font-bold text-white text-base">📋 自訂名單即時報價</h3>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  {customTickers.length > 0 ? (
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
                        {filteredCustomResults.length > 0 ? (
                          filteredCustomResults.map((row, idx) => {
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
                                  {row["Volume"] ? `${(row["Volume"] / 1000000).toFixed(2)}M` : 'N/A'}
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
                            <td colSpan={10} className="py-12 text-center text-gray-500 font-medium">
                              自訂監控名單中沒有符合您過濾條件的標的。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-12 text-center text-gray-600">
                      <ShieldAlert className="mx-auto mb-2 text-gray-700" size={32} />
                      <span>目前自訂監控名單為空，請於上方新增股票代碼。</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
              
              {/* Section 1: Top Gainers Settings */}
              <details className="group bg-gray-950/40 border border-gray-800 rounded-3xl shadow-xl overflow-hidden" open>
                <summary className="flex justify-between items-center p-6 cursor-pointer list-none bg-gray-900/30 hover:bg-gray-800/40 transition-colors">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                      <Sliders size={18} className="text-indigo-400" />
                      <span>📡 Top Gainers 篩選設定</span>
                    </h3>
                    <p className="text-gray-400 text-xs mt-1 group-open:opacity-100 opacity-80">設定 API 請求頻率、保留時間與各項過濾條件閥值。</p>
                  </div>
                  <div className="text-gray-500 group-open:rotate-180 transition-transform duration-300">
                    ▼
                  </div>
                </summary>
                
                <div className="p-6 pt-0 border-t border-gray-800/50 space-y-8 text-left mt-6">
                  
                  {/* Basic Config */}
                  <div>
                    <h4 className="text-sm font-bold text-gray-300 mb-4 flex items-center space-x-2">
                      <span>⚙️ 基礎與自動整理配置</span>
                    </h4>
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

                  {/* Threshold Filters */}
                  <div className="border-t border-gray-800/60 pt-8">
                    <h4 className="text-sm font-bold text-gray-300 mb-6 flex items-center space-x-2">
                      <span>⚡ 閥值篩選條件設定</span>
                    </h4>

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

                  {/* ── Volume Filter ─────────────────────────────────── */}
                  <FilterToggleRow
                    title="成交量範圍 (Volume)"
                    description="設定篩選標的的當日成交量區間（以百萬股 M 為單位）。"
                    isActive={filterVolume}
                    onToggle={setFilterVolume}
                  >
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-gray-500">最低:</span>
                      <NumericInput value={minVolume} onChange={setMinVolume} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-24 text-right focus:outline-none focus:border-indigo-500" />
                      <span className="text-gray-500">M</span>
                      <span className="text-gray-500 pl-2">最高:</span>
                      <NumericInput value={maxVolume} onChange={setMaxVolume} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-24 text-right focus:outline-none focus:border-indigo-500" />
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
              </details>

              {/* Section 2: Custom Watchlist Settings */}
              <details className="group bg-gray-950/40 border border-gray-800 rounded-3xl shadow-xl overflow-hidden" open>
                <summary className="flex justify-between items-center p-6 cursor-pointer list-none bg-gray-900/30 hover:bg-gray-800/40 transition-colors">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                      <Sliders size={18} className="text-indigo-400" />
                      <span>📋 My Watchlist 篩選設定</span>
                    </h3>
                    <p className="text-gray-400 text-xs mt-1 group-open:opacity-100 opacity-80">設定自訂監控名單的獨立過濾條件。</p>
                  </div>
                  <div className="text-gray-500 group-open:rotate-180 transition-transform duration-300">
                    ▼
                  </div>
                </summary>

                <div className="p-6 pt-0 border-t border-gray-800/50 space-y-6 text-left mt-6">
                  {/* Independent Custom Filters */}
                  <div className="divide-y divide-gray-800/60 space-y-6 pt-4">
                      <FilterToggleRow
                        title="開盤跳空幅度 (Gap %)"
                        description="過濾今日開盤相對於昨日收盤的跳空上漲幅度。"
                        isActive={customFilters.filterGap}
                        onToggle={(v) => updateCustomFilter('filterGap', v)}
                      >
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-gray-500">最低:</span>
                          <NumericInput value={customFilters.minGap} onChange={(v) => updateCustomFilter('minGap', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">%</span>
                        </div>
                      </FilterToggleRow>

                      <FilterToggleRow
                        title="今日漲幅 (Gainer %)"
                        description="過濾相對於昨日收盤價的今日總漲幅。"
                        isActive={customFilters.filterGainer}
                        onToggle={(v) => updateCustomFilter('filterGainer', v)}
                      >
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-gray-500">最低:</span>
                          <NumericInput value={customFilters.minGainer} onChange={(v) => updateCustomFilter('minGainer', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">%</span>
                        </div>
                      </FilterToggleRow>

                      <FilterToggleRow
                        title="開盤到目前漲幅 (Intraday %)"
                        description="過濾標的自今日開盤價算起，到目前為止的盤中漲幅。"
                        isActive={customFilters.filterIntraday}
                        onToggle={(v) => updateCustomFilter('filterIntraday', v)}
                      >
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-gray-500">最低:</span>
                          <NumericInput value={customFilters.minIntraday} onChange={(v) => updateCustomFilter('minIntraday', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">%</span>
                        </div>
                      </FilterToggleRow>

                      <FilterToggleRow
                        title={`最近 ${recentMinsWindow} 分鐘最大漲幅 (%)`}
                        description="衡量近期動能，從拉回低點發動的最強漲勢幅度。"
                        isActive={customFilters.filterInterval}
                        onToggle={(v) => updateCustomFilter('filterInterval', v)}
                      >
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-gray-500">最低:</span>
                          <NumericInput value={customFilters.minIntervalPct} onChange={(v) => updateCustomFilter('minIntervalPct', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">%</span>
                        </div>
                      </FilterToggleRow>

                      <FilterToggleRow
                        title="市值範圍 (Market Cap, M)"
                        description="設定篩選公司的總市值區間（以百萬美元 M 為單位）。"
                        isActive={customFilters.filterMktCap}
                        onToggle={(v) => updateCustomFilter('filterMktCap', v)}
                      >
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-gray-500">最低:</span>
                          <NumericInput value={customFilters.minMktCap} onChange={(v) => updateCustomFilter('minMktCap', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">M</span>
                          <span className="text-gray-500 pl-2">最高:</span>
                          <NumericInput value={customFilters.maxMktCap} onChange={(v) => updateCustomFilter('maxMktCap', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">M</span>
                        </div>
                      </FilterToggleRow>

                      <FilterToggleRow
                        title="流通股數範圍 (Float, M)"
                        description="設定篩選公司的流通股數量區間（以百萬股 M 為單位）。"
                        isActive={customFilters.filterFloat}
                        onToggle={(v) => updateCustomFilter('filterFloat', v)}
                      >
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-gray-500">最低:</span>
                          <NumericInput value={customFilters.minFloat} onChange={(v) => updateCustomFilter('minFloat', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">M</span>
                          <span className="text-gray-500 pl-2">最高:</span>
                          <NumericInput value={customFilters.maxFloat} onChange={(v) => updateCustomFilter('maxFloat', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">M</span>
                        </div>
                      </FilterToggleRow>

                      <FilterToggleRow
                        title="成交量範圍 (Volume)"
                        description="設定篩選標的的當日成交量區間（以百萬股 M 為單位）。"
                        isActive={customFilters.filterVolume}
                        onToggle={(v) => updateCustomFilter('filterVolume', v)}
                      >
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-gray-500">最低:</span>
                          <NumericInput value={customFilters.minVolume} onChange={(v) => updateCustomFilter('minVolume', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-24 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">M</span>
                          <span className="text-gray-500 pl-2">最高:</span>
                          <NumericInput value={customFilters.maxVolume} onChange={(v) => updateCustomFilter('maxVolume', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-24 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">M</span>
                        </div>
                      </FilterToggleRow>

                      <FilterToggleRow
                        title="股票價格範圍 ($)"
                        description="過濾標的的股價上下限區間。"
                        isActive={customFilters.filterPrice}
                        onToggle={(v) => updateCustomFilter('filterPrice', v)}
                      >
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="text-gray-500">最低:</span>
                          <NumericInput step={0.01} value={customFilters.minPrice} onChange={(v) => updateCustomFilter('minPrice', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">$</span>
                          <span className="text-gray-500 pl-2">最高:</span>
                          <NumericInput step={0.01} value={customFilters.maxPrice} onChange={(v) => updateCustomFilter('maxPrice', v)} className="bg-gray-900 border border-gray-800 rounded-xl px-2 py-1.5 text-white w-20 text-right focus:outline-none focus:border-indigo-500" />
                          <span className="text-gray-500">$</span>
                        </div>
                      </FilterToggleRow>
                    </div>
                </div>
              </details>
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
