import type { NavTab } from '../types';

interface TopBarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onNewProject: () => void;
}

const NAV_ITEMS: { id: NavTab; label: string }[] = [
  { id: 'workbench', label: '워크벤치' },
  { id: 'environment', label: '환경 탐지' },
  { id: 'projects', label: '프로젝트 목록' },
  { id: 'desktop', label: '데스크톱 빌드' },
];

export function TopBar({ activeTab, onSelectTab, onNewProject }: TopBarProps) {
  return (
    <header className="h-14 shrink-0 border-b border-slate-800/90 bg-[#0E131D] px-6 flex items-center justify-between gap-8">
      {/* Zone 1: Single-line Wordmark */}
      <button
        type="button"
        onClick={() => onSelectTab('workbench')}
        className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
      >
        CodeForge
      </button>

      {/* Zone 2: Navigation Links */}
      <nav aria-label="주 메뉴" className="flex items-center gap-7 h-full overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative h-full flex items-center text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isActive ? 'text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
              {isActive && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-500" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single Primary Action */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={onNewProject}
          className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          새 프로젝트
        </button>
      </div>
    </header>
  );
}
