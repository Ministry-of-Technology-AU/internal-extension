import React from 'react';

export default function Layout({ children, currentTab, setCurrentTab }: { children: React.ReactNode, currentTab: string, setCurrentTab: (tab: string) => void }) {
  const tabs = [
    { id: 'sync-planner', label: 'Sync Planner' },
  ];

  return (
    <div className="layout">
      <nav className="sidebar">
        <h2>Tools</h2>
        <ul>
          {tabs.map((tab) => (
            <li 
              key={tab.id} 
              className={currentTab === tab.id ? 'active' : ''}
              onClick={() => setCurrentTab(tab.id)}
            >
              {tab.label}
            </li>
          ))}
        </ul>
      </nav>
      <main className="content">
        {children}
      </main>
    </div>
  );
}
