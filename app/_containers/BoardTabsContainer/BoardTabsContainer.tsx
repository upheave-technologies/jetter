'use client';

import { useState } from 'react';
import { Calendar, BarChart2 } from 'lucide-react';

type Tab = 'raspored' | 'gustoca';

type BoardTabsContainerProps = {
  rasporedTab: React.ReactNode;
  gustocaTab: React.ReactNode;
};

export function BoardTabsContainer({ rasporedTab, gustocaTab }: BoardTabsContainerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('raspored');

  return (
    <>
      {/* Tab bar — sticky below DayNav */}
      <div
        role="tablist"
        aria-label="Prikaz ploče"
        className="sticky top-0 z-10 bg-card border-b border-border shadow-card-md flex"
      >
        <button
          role="tab"
          id="tab-raspored"
          aria-selected={activeTab === 'raspored'}
          aria-controls="panel-raspored"
          tabIndex={activeTab === 'raspored' ? 0 : -1}
          onClick={() => setActiveTab('raspored')}
          className={`flex-1 py-3 font-bold text-sm flex items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            activeTab === 'raspored'
              ? 'bg-primary text-primary-foreground'
              : 'bg-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Calendar className="h-4 w-4" aria-hidden="true" />
          Raspored
        </button>
        <button
          role="tab"
          id="tab-gustoca"
          aria-selected={activeTab === 'gustoca'}
          aria-controls="panel-gustoca"
          tabIndex={activeTab === 'gustoca' ? 0 : -1}
          onClick={() => setActiveTab('gustoca')}
          className={`flex-1 py-3 font-bold text-sm flex items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            activeTab === 'gustoca'
              ? 'bg-primary text-primary-foreground'
              : 'bg-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <BarChart2 className="h-4 w-4" aria-hidden="true" />
          Gustoća
        </button>
      </div>

      {/* Tab panels */}
      <div
        role="tabpanel"
        id="panel-raspored"
        aria-labelledby="tab-raspored"
        hidden={activeTab !== 'raspored'}
      >
        {rasporedTab}
      </div>
      <div
        role="tabpanel"
        id="panel-gustoca"
        aria-labelledby="tab-gustoca"
        hidden={activeTab !== 'gustoca'}
      >
        {gustocaTab}
      </div>
    </>
  );
}
