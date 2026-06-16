import React, { useState } from 'react';
import { 
  FolderHeart, 
  Trash2, 
  Download, 
  Calendar,
  Layers
} from 'lucide-react';

interface WatchlistManagerProps {
  savedScans: { [timestamp: string]: any[] };
  onDeleteScan: (timestamp: string) => void;
  onClearAllScans: () => void;
}

export const WatchlistManager: React.FC<WatchlistManagerProps> = ({ savedScans, onDeleteScan, onClearAllScans }) => {
  const timestamps = Object.keys(savedScans).reverse(); // Newest first
  const [selectedScanTime, setSelectedScanTime] = useState<string>(timestamps[0] || '');

  // Sync selected timestamp if timestamps list changes
  React.useEffect(() => {
    if (timestamps.length > 0 && (!selectedScanTime || !savedScans[selectedScanTime])) {
      setSelectedScanTime(timestamps[0]);
    }
  }, [savedScans]);

  // Aggregate and merge all unique stocks across all scans
  const getMergedWatchlist = (): any[] => {
    const mergedMap = new Map<string, any>();
    Object.values(savedScans).forEach(scanArray => {
      scanArray.forEach(stock => {
        if (!mergedMap.has(stock.Ticker)) {
          mergedMap.set(stock.Ticker, stock);
        }
      });
    });
    return Array.from(mergedMap.values());
  };

  const mergedWatchlist = getMergedWatchlist();
  const activeScanData = selectedScanTime ? savedScans[selectedScanTime] || [] : [];

  // Export any scan table to CSV
  const handleExportCsv = (data: any[], filename: string) => {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => 
      Object.values(row).map(val => {
        const str = String(val);
        return str.includes(',') ? `"${str}"` : str;
      }).join(',')
    );
    const csvContent = "data:text/csv;charset=utf-8-sig,\uFEFF" + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-gray-900 text-gray-100 p-8">
      {/* Title */}
      <div className="mb-8 border-b border-gray-800 pb-4">
        <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
          <span>🗂️ 歷次掃描與自選股保存庫</span>
          <span className="text-xs bg-indigo-500/20 text-indigo-400 font-semibold px-2 py-0.5 rounded-full">Saved Watchlist</span>
        </h2>
        <p className="text-gray-400 text-sm mt-1">
          檢視與合併您在歷史策略掃描中所儲存的個股。此保存庫存於您瀏覽器的記憶體中，在此處重新設定篩選條件不會覆蓋此區紀錄。
          </p>
      </div>

      {timestamps.length > 0 ? (
        <div className="space-y-8">
          {/* Main layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Dropdown & Scan info */}
            <div className="lg:col-span-1 bg-gray-950/40 p-6 rounded-2xl border border-gray-800 space-y-6 self-start">
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-1.5">
                  <Calendar size={14} className="text-indigo-400" />
                  <span>選擇保存紀錄時間</span>
                </h3>
                <select
                  value={selectedScanTime}
                  onChange={(e) => setSelectedScanTime(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  {timestamps.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Scan details card */}
              <div className="bg-gray-900/60 p-4 rounded-xl border border-gray-800 text-sm space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-500 font-medium">該批存檔股票數：</span>
                  <span className="text-white font-bold">{activeScanData.length} 檔</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-medium">備註類型：</span>
                  <span className="text-indigo-400 font-bold">歷史策略自選</span>
                </div>
              </div>

              <div className="flex flex-col space-y-2">
                <button
                  onClick={() => handleExportCsv(activeScanData, `scan_history_${selectedScanTime.replace(/:/g, '-')}.csv`)}
                  className="w-full bg-gray-900 hover:bg-gray-800 text-gray-200 border border-gray-800 rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Download size={14} />
                  <span>匯出此批自選 (CSV)</span>
                </button>
                <button
                  onClick={() => {
                    onDeleteScan(selectedScanTime);
                  }}
                  className="w-full bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Trash2 size={14} />
                  <span>刪除此筆存檔</span>
                </button>
                <button
                  onClick={onClearAllScans}
                  className="w-full bg-red-600 hover:bg-red-500 text-white rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Trash2 size={14} />
                  <span>清空所有保存紀錄 🧨</span>
                </button>
              </div>
            </div>

            {/* Right Column: Selected Scan Table */}
            <div className="lg:col-span-2 bg-gray-950/40 border border-gray-800 rounded-3xl overflow-hidden flex flex-col shadow-xl">
              <div className="p-4 border-b border-gray-800 bg-gray-950/60 font-semibold text-gray-200 text-sm">
                🔍 該次存檔明細 ({selectedScanTime})
              </div>
              <div className="overflow-x-auto overflow-y-auto max-h-[50vh]">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-900/60 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase">
                      <th className="py-3.5 px-6">代碼</th>
                      <th className="py-3.5 px-6">名稱</th>
                      <th className="py-3.5 px-6">產業</th>
                      <th className="py-3.5 px-6">市值</th>
                      <th className="py-3.5 px-6 text-right">收盤價</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/80">
                    {activeScanData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-800/25 transition-colors">
                        <td className="py-3 px-6 font-bold text-white tracking-wide">{row.Ticker}</td>
                        <td className="py-3 px-6 text-gray-300">{row.Name}</td>
                        <td className="py-3 px-6 text-gray-400">{row.Sector}</td>
                        <td className="py-3 px-6 text-gray-400">{row["Market Cap"]}</td>
                        <td className="py-3 px-6 text-right font-semibold text-gray-200">${row.Close}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Ultimate Watchlist (All Scans Consolidated) */}
          <div className="bg-gray-950/40 border border-gray-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="flex justify-between items-center p-5 border-b border-gray-800 bg-gray-950/60">
              <div className="flex items-center space-x-2">
                <Layers size={18} className="text-indigo-400" />
                <h3 className="font-bold text-white text-base">🌟 歷次紀錄合併去重總覽 (Ultimate Watchlist)</h3>
              </div>
              <button
                onClick={() => handleExportCsv(mergedWatchlist, 'ultimate_watchlist.csv')}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-xl flex items-center space-x-2 transition-colors cursor-pointer"
              >
                <Download size={14} />
                <span>匯出終極合併總表 (CSV)</span>
              </button>
            </div>

            <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-900/40 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase">
                    <th className="py-3.5 px-6">代碼</th>
                    <th className="py-3.5 px-6">名稱</th>
                    <th className="py-3.5 px-6">產業</th>
                    <th className="py-3.5 px-6">市值</th>
                    <th className="py-3.5 px-6 text-right">收盤價</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/80">
                  {mergedWatchlist.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-800/25 transition-colors">
                      <td className="py-3 px-6 font-bold text-white tracking-wide">{row.Ticker}</td>
                      <td className="py-3 px-6 text-gray-300">{row.Name}</td>
                      <td className="py-3 px-6 text-gray-400">{row.Sector}</td>
                      <td className="py-3 px-6 text-gray-400">{row["Market Cap"]}</td>
                      <td className="py-3 px-6 text-right font-semibold text-gray-200">${row.Close}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-950/20 border border-dashed border-gray-800 rounded-3xl p-16 text-center flex flex-col items-center justify-center min-h-[50vh]">
          <FolderHeart size={48} className="text-gray-700 mb-4" />
          <h3 className="text-gray-400 font-bold mb-1">自選庫中目前沒有資料</h3>
          <p className="text-gray-600 text-sm max-w-md">
            請至「歷史策略掃描」頁面執行掃描，並在篩選出的表格上方點擊「儲存至歷史庫存」按鈕，該次掃描的精華標的便會永久儲存於此標籤頁。
          </p>
        </div>
      )}
    </div>
  );
};
export default WatchlistManager;
