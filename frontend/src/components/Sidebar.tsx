import React from 'react';
import { 
  BarChart2, 
  Activity, 
  FolderHeart, 
  FlaskConical, 
  BrainCircuit, 
  KeyRound 
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, apiKey, setApiKey }) => {
  const menuItems = [
    { id: 'scan', label: '歷史策略掃描', icon: BarChart2 },
    { id: 'realtime', label: '即時監控篩選', icon: Activity },
    { id: 'history', label: '歷次掃描庫存', icon: FolderHeart },
    { id: 'vector_bt', label: '量化回測實驗室', icon: FlaskConical },
    { id: 'backtrader', label: '大腦引擎模擬器', icon: BrainCircuit },
  ];

  return (
    <aside className="w-64 bg-gray-950 border-r border-gray-900 flex flex-col justify-between text-gray-100 min-h-screen shrink-0">
      <div className="p-6">
        {/* Brand logo */}
        <div className="flex items-center space-x-3 mb-8">
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-600/30">
            <Activity size={24} className="animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              Stock Scanner
            </h1>
            <span className="text-xs text-gray-500 font-medium">PRO Edition v1.0</span>
          </div>
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
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Global Config Panel */}
      <div className="p-6 border-t border-gray-900 bg-gray-950 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            <KeyRound size={14} className="text-indigo-400" />
            <span>FMP API 金鑰</span>
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
    </aside>
  );
};
export default Sidebar;
