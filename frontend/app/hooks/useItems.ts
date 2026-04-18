'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useData } from '../context/DataContext';

const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

export function useItems(params: { skip?: number, limit?: number, search?: string, category?: string } = {}) {
  const { authFetch } = useData();
  const { skip = 0, limit = 50, search = '', category = '' } = params;

  return useQuery({
    queryKey: ['items', { skip, limit, search, category }],
    queryFn: async () => {
      const url = `${API_BASE}/items?skip=${skip}&limit=${limit}&search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error('Failed to fetch items');
      return res.json();
    }
  });
}

export function useCreateItem() {
  const { authFetch } = useData();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: any) => {
      const res = await authFetch(`${API_BASE}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to create item');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    }
  });
}

export function useItemByCode(code: string | null) {
  const { authFetch } = useData();

  return useQuery({
    queryKey: ['item', code],
    queryFn: async () => {
      if (!code) return null;
      // Note: We'd need a specific endpoint for get_by_code or just use the filter
      const res = await authFetch(`${API_BASE}/items?search=${encodeURIComponent(code)}&limit=1`);
      if (!res.ok) throw new Error('Failed to fetch item');
      const data = await res.json();
      return data.items.find((i: any) => i.code === code) || null;
    },
    enabled: !!code
  });
}
