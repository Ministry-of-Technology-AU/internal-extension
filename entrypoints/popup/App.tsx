import { useState } from 'react';
import Layout from '@/components/Layout';
import SyncSemesterPlanner from '@/tools/SyncSemesterPlanner';
import './App.css';

function App() {
  const [currentTab, setCurrentTab] = useState('sync-planner');

  return (
    <Layout currentTab={currentTab} setCurrentTab={setCurrentTab}>
      {currentTab === 'sync-planner' && <SyncSemesterPlanner />}
    </Layout>
  );
}

export default App;
