import React from 'react';
import { useStore } from './hooks/useStore';
import ConnectPage from './pages/ConnectPage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  const connection = useStore((s) => s.connection);
  return connection.connected ? <DashboardPage /> : <ConnectPage />;
}
