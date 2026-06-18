import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import HistoricalScanner from './components/HistoricalScanner';
import RealTimeScreener from './components/RealTimeScreener';
import WatchlistManager from './components/WatchlistManager';
import Backtesters from './components/Backtesters';
import { ChevronRight } from 'lucide-react';

// FastAPI Server Base URL
const BASE_URL = 'http://127.0.0.1:8000';

function App() {
  const [activeTab, setActiveTab] = useState<string>('scan');
  
  // Persistent API key in localStorage
  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem('FMP_API_KEY') || '';
  });

  // Persistent sidebar states in local storage
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('SIDEBAR_WIDTH');
    return saved ? parseInt(saved, 10) : 256;
  });

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('SIDEBAR_COLLAPSED') === 'true';
  });

  // Persistent scanned stock watchlist in local storage
  const [savedScans, setSavedScans] = useState<{ [timestamp: string]: any[] }>(() => {
    try {
      const saved = localStorage.getItem('SAVED_SCANS');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // List of active tickers found in latest scans to autofill backtester
  const [scannedTickers, setScannedTickers] = useState<string[]>([]);

  // Sync API Key to localStorage
  useEffect(() => {
    localStorage.setItem('FMP_API_KEY', apiKey);
  }, [apiKey]);

  // Sync Sidebar Width to localStorage
  useEffect(() => {
    localStorage.setItem('SIDEBAR_WIDTH', sidebarWidth.toString());
  }, [sidebarWidth]);

  // Sync Sidebar Collapsed to localStorage
  useEffect(() => {
    localStorage.setItem('SIDEBAR_COLLAPSED', isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);

  // Sync Scans History to localStorage
  useEffect(() => {
    localStorage.setItem('SAVED_SCANS', JSON.stringify(savedScans));
  }, [savedScans]);

  // Handler to add scan results to historical database
  const handleSaveScan = (results: any[]) => {
    const timestamp = new Date().toLocaleString('zh-TW', { hour12: false });
    setSavedScans(prev => ({
      ...prev,
      [timestamp]: results
    }));

    // Extract unique tickers and store for default inputs in backtest page
    const tickers = results.map(r => r.Ticker);
    setScannedTickers(prev => Array.from(new Set([...prev, ...tickers])));
  };

  // Handler to delete single scan record
  const handleDeleteScan = (timestamp: string) => {
    setSavedScans(prev => {
      const updated = { ...prev };
      delete updated[timestamp];
      return updated;
    });
  };

  // Handler to clear history
  const handleClearAllScans = () => {
    if (window.confirm('確定要清空所有的歷史保存自選股嗎？此動作無法復原。')) {
      setSavedScans({});
    }
  };

  return (
    <div className="flex h-screen w-screen bg-gray-950 overflow-hidden text-gray-100 font-sans antialiased">
      {/* Sidebar navigation */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        apiKey={apiKey} 
        setApiKey={setApiKey} 
        sidebarWidth={sidebarWidth}
        setSidebarWidth={setSidebarWidth}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
      />

      {/* Main dashboard content area */}
      <main className={`relative flex-1 flex flex-col min-w-0 overflow-hidden bg-gray-900 ${isSidebarCollapsed ? 'pl-16' : ''}`}>
        {isSidebarCollapsed && (
          <button 
            onClick={() => setIsSidebarCollapsed(false)}
            className="absolute top-7 left-5 z-40 bg-gray-950/80 backdrop-blur border border-gray-800 p-2.5 rounded-xl text-gray-400 hover:text-white shadow-lg hover:bg-indigo-600 hover:border-indigo-500 hover:shadow-indigo-600/20 transition-all duration-200 cursor-pointer animate-in fade-in"
            title="展開側邊欄"
          >
            <ChevronRight size={18} />
          </button>
        )}

        {activeTab === 'scan' && (
          <HistoricalScanner 
            apiKey={apiKey} 
            onSaveScan={handleSaveScan} 
            BASE_URL={BASE_URL} 
          />
        )}
        {activeTab === 'realtime' && (
          <RealTimeScreener 
            apiKey={apiKey} 
            BASE_URL={BASE_URL} 
          />
        )}
        {activeTab === 'history' && (
          <WatchlistManager 
            savedScans={savedScans} 
            onDeleteScan={handleDeleteScan} 
            onClearAllScans={handleClearAllScans} 
          />
        )}
        {(activeTab === 'vector_bt' || activeTab === 'backtrader') && (
          <Backtesters 
            key={activeTab}
            apiKey={apiKey} 
            scannedTickers={scannedTickers} 
            BASE_URL={BASE_URL} 
            initialTab={activeTab === 'vector_bt' ? 'vector' : 'backtrader'}
          />
        )}
      </main>
    </div>
  );
}

export default App;
