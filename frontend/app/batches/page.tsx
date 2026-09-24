'use client';

import BatchesView from '../components/inventory/BatchesView';
import { useData } from '../context/DataContext';
import { API_BASE } from '../components/shared/apiBase';

export default function BatchesPage() {
  const { items, locations, categories, workCenters, authFetch } = useData();


  return <BatchesView items={items} locations={locations} categories={categories} workCenters={workCenters} authFetch={authFetch} apiBase={API_BASE} />;
}
