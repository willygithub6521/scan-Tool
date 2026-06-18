import React, { useState } from 'react';
import { 
  BarChart2, 
  Activity, 
  FolderHeart, 
  FlaskConical, 
  BrainCircuit, 
  KeyRound,
  ChevronLeft
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  activeTab, 
  setActiveTab, 
  apiKey, 
  setApiKey,
  sidebarWidth,
  setSidebarWidth,
  isCollapsed,
  setIsCollapsed
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const menuItems = [
    { id: 'scan', label: '歷史策略掃描', icon: BarChart2 },
    { id: 'realtime', label: '即時監控篩選', icon: Activity },
    { id: 'history', label: '歷次掃描庫存', icon: FolderHeart },
    { id: 'vector_bt', label: '量化回測實驗室', icon: FlaskConical },
    { id: 'backtrader', label: '大腦引擎模擬器', icon: BrainCircuit },
  ];

  const startResizing = React.useCallback((mouseDownEvent: React.MouseEvent) => {
    setIsDragging(true);
    mouseDownEvent.preventDefault();
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsDragging(false);
  }, []);

  const resize = React.useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isDragging) {
        const newWidth = mouseMoveEvent.clientX;
        if (newWidth >= 180 && newWidth <= 480) {
          setSidebarWidth(newWidth);
        }
      }
    },
    [isDragging, setSidebarWidth]
  );

  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isDragging, resize, stopResizing]);

  const resetWidth = React.useCallback(() => {
    setSidebarWidth(256);
  }, [setSidebarWidth]);

  return (
    <aside 
      style={{ width: isCollapsed ? 0 : sidebarWidth }} 
      className={`relative bg-gray-950 border-r border-gray-900 flex flex-col justify-between text-gray-100 min-h-screen shrink-0 ${
        isDragging ? '' : 'transition-all duration-300 ease-in-out'
      } ${isCollapsed ? 'border-r-0 overflow-hidden pointer-events-none' : ''}`}
    >
      <div 
        style={{ width: sidebarWidth }}
        className="flex flex-col justify-between h-full shrink-0"
      >
        <div className="p-6">
          {/* Brand logo & Collapse Button */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-3 overflow-hidden">
              <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-600/30 shrink-0">
                <Activity size={24} className="animate-pulse" />
              </div>
              <div className="truncate">
                <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent truncate font-bold">
                  Stock Scanner
                </h1>
                <span className="text-xs text-gray-500 font-medium block">PRO Edition v1.0</span>
              </div>
            </div>
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-gray-900 transition-colors shrink-0 cursor-pointer"
              title="收起側邊欄"
            >
              <ChevronLeft size={18} />
            </button>
          </div>

          {/* Navigation list */}
          <nav className="space-y-1.5">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive 
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' 
                      : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                  }`}
                >
                  <Icon size={18} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Global Config Panel */}
        <div className="p-6 border-t border-gray-900 bg-gray-950 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center space-x-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              <KeyRound size={14} className="text-indigo-400 shrink-0" />
              <span className="truncate">FMP API 金鑰</span>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="請輸入 API Key"
              className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <p className="text-[10px] text-gray-600 leading-normal">
              API 金鑰將安全儲存於您本機瀏覽器的 LocalStorage 中。
            </p>
          </div>
        </div>
      </div>

      {/* Resize Handle */}
      {!isCollapsed && (
        <div
          onMouseDown={startResizing}
          onDoubleClick={resetWidth}
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:w-1.5 hover:bg-indigo-500/50 active:w-1.5 active:bg-indigo-500 transition-all z-50 ${
            isDragging ? 'bg-indigo-500 w-1.5' : ''
          }`}
          title="左右拖曳調整寬度，雙擊重設"
        />
      )}
    </aside>
  );
};
export default Sidebar;
