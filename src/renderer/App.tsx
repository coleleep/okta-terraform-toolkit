import React from 'react';
import DashboardPage from './pages/DashboardPage';
import ExportGateModal from './components/ExportGateModal';

export default function App() {
  return (
    <div>
      <DashboardPage />
      <ExportGateModal />
    </div>
  );
}
