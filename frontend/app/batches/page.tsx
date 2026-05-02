'use client';

import BatchesView from '../components/inventory/BatchesView';
import { useData } from '../context/DataContext';

export default function BatchesPage() {
  const { items, authFetch } = useData();

  const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
  const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

  return <BatchesView items={items} authFetch={authFetch} apiBase={API_BASE} />;
}
