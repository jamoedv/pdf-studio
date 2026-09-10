import React from 'react';
import { Sparkles, Bookmark, History, BarChart3, Users, DollarSign, FolderCog, LayoutGrid } from 'lucide-react';
import DocmaiticLogo from './DocmaiticLogo';

export default function Sidebar({
  categories,
  activeGroup,
  activeCategory,
  activeTab,
  activePanel,
  currentUser,
  switchGroup,
  switchTab,
  setActivePanel,
  setShowMoreMenu,
}) {
  const visibleCategories = categories.filter((cat) => cat.group === activeGroup);

  const goHome = () => {
    setActivePanel(null);
    if (setShowMoreMenu) setShowMoreMenu(false);
    switchGroup('no-ai');
  };

  const NavRow = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 pl-3 pr-2.5 py-1.5 rounded-md text-sm text-left transition-colors ${
        active ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      <span className={`w-[3px] h-3.5 rounded-full flex-shrink-0 ${active ? 'bg-blue-900' : 'bg-transparent'}`} />
      <span className="truncate">{children}</span>
    </button>
  );

  return (
    <div className="w-[232px] flex-shrink-0 h-screen overflow-y-auto border-r border-slate-200 bg-white flex flex-col">
      <div className="p-4 pb-3">
        <button onClick={goHome} className="hover:opacity-80 transition-opacity">
          <DocmaiticLogo size={17} />
        </button>
      </div>

      <div className="px-4 pb-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            onClick={() => switchGroup('no-ai')}
            className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeGroup === 'no-ai' && !activePanel ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Werkzeuge
          </button>
          <button
            onClick={() => switchGroup('ai')}
            className={`flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeGroup === 'ai' && !activePanel ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            Mit KI
          </button>
        </div>
      </div>

      <div className="px-2.5 pb-3">
        <NavRow active={activePanel === 'apps'} onClick={() => setActivePanel('apps')}>
          <span className="flex items-center gap-2 font-medium"><LayoutGrid className="w-3.5 h-3.5" />Apps</span>
        </NavRow>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 space-y-4 pb-4">
        {visibleCategories.map((cat) => (
          <div key={cat.id}>
            <p className="px-2.5 mb-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider">{cat.label}</p>
            <div className="space-y-0.5">
              {cat.tabs.map((tab) => (
                <NavRow key={tab.id} active={!activePanel && activeTab === tab.id} onClick={() => switchTab(tab.id)}>
                  {tab.label}
                </NavRow>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-2.5 py-3 border-t border-slate-100 space-y-0.5">
        <p className="px-2.5 mb-1 text-[10px] font-medium text-slate-400 uppercase tracking-wider">Verwaltung</p>
        <NavRow active={activePanel === 'templates'} onClick={() => setActivePanel('templates')}>
          <span className="flex items-center gap-2"><Bookmark className="w-3.5 h-3.5" />Bibliothek</span>
        </NavRow>
        <NavRow active={activePanel === 'history'} onClick={() => setActivePanel('history')}>
          <span className="flex items-center gap-2"><History className="w-3.5 h-3.5" />History</span>
        </NavRow>
        <NavRow active={activePanel === 'stats'} onClick={() => setActivePanel('stats')}>
          <span className="flex items-center gap-2"><BarChart3 className="w-3.5 h-3.5" />Dashboard</span>
        </NavRow>
        {currentUser?.role === 'admin' && (
          <NavRow active={activePanel === 'admin'} onClick={() => setActivePanel('admin')}>
            <span className="flex items-center gap-2"><Users className="w-3.5 h-3.5" />Nutzerverwaltung</span>
          </NavRow>
        )}
        {currentUser?.role === 'admin' && (
          <NavRow active={activePanel === 'usage'} onClick={() => setActivePanel('usage')}>
            <span className="flex items-center gap-2"><DollarSign className="w-3.5 h-3.5" />Nutzung & Kosten</span>
          </NavRow>
        )}
        <NavRow active={activePanel === 'watchedFolders'} onClick={() => setActivePanel('watchedFolders')}>
          <span className="flex items-center gap-2"><FolderCog className="w-3.5 h-3.5" />Ordner-Überwachung</span>
        </NavRow>
      </div>
    </div>
  );
}
