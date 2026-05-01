'use client';

type Tab = 'params' | 'preview' | 'experiments' | 'history';

interface TabNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  frozen: boolean;
}

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'params', label: 'Параметры', icon: '⚙️' },
  { id: 'preview', label: 'Live Preview', icon: '👁️' },
  { id: 'experiments', label: 'Эксперименты', icon: '🧪' },
  { id: 'history', label: 'История', icon: '📜' },
];

export function TabNav({ activeTab, onTabChange, frozen }: TabNavProps) {
  return (
    <div className="flex gap-1 mb-4 bg-gray-900 p-1 rounded-lg">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 py-2 px-4 rounded text-sm font-medium transition-colors ${
            activeTab === tab.id
              ? 'bg-cyan-600 text-white'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
          }`}
        >
          <span className="mr-1">{tab.icon}</span>
          {tab.label}
          {frozen && tab.id === 'params' && (
            <span className="ml-2 text-xs bg-amber-900 text-amber-300 px-1 rounded">
              FROZEN
            </span>
          )}
        </button>
      ))}
    </div>
  );
}