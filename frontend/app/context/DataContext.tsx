'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from './UserContext';
import { useToast } from '../components/shared/Toast';

const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;

interface DataContextType {
    items: any[];
    locations: any[];
    attributes: any[];
    categories: any[];
    uoms: any[];
    sizes: any[];
    boms: any[];
    manufacturingOrders: any[];
    productionRuns: any[];
    stockEntries: any[];
    stockBalance: any[];
    workCenters: any[];
    operations: any[];
    salesOrders: any[];
    purchaseOrders: any[];
    samples: any[];
    auditLogs: any[];
    partners: any[];
    dashboardKPIs: any;
    companyProfile: any;

    // Pagination & Search State
    pagination: {
        itemPage: number; setItemPage: (p: number) => void; itemTotal: number;
        woPage: number; setWoPage: (p: number) => void; woTotal: number;
        prPage: number; setPrPage: (p: number) => void; prTotal: number;
        auditPage: number; setAuditPage: (p: number) => void; auditTotal: number;
        reportPage: number; setReportPage: (p: number) => void; reportTotal: number;
        pageSize: number;
    };
    
    filters: {
        itemSearch: string; setItemSearch: (s: string) => void;
        itemCategory: string; setItemCategory: (c: string) => void;
        auditType: string; setAuditType: (t: string) => void;
    };

    fetchData: (targetTab?: string) => Promise<void>;
    handleTabHover: (tab: string) => void;
    authFetch: (url: string, options?: any) => Promise<Response>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
    const { currentUser } = useUser();
    const { showToast } = useToast();

    // Data State
    const [items, setItems] = useState([]);
    const [locations, setLocations] = useState([]);
    const [attributes, setAttributes] = useState([]);
    const [categories, setCategories] = useState([]);
    const [uoms, setUoms] = useState([]);
    const [sizes, setSizes] = useState([]);
    const [boms, setBoms] = useState([]);
    const [manufacturingOrders, setManufacturingOrders] = useState<any[]>([]);
    const [productionRuns, setProductionRuns] = useState<any[]>([]);
    const [stockEntries, setStockEntries] = useState([]);
    const [stockBalance, setStockBalance] = useState([]);
    const [workCenters, setWorkCenters] = useState([]);
    const [operations, setOperations] = useState([]);
    const [salesOrders, setSalesOrders] = useState([]);
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [samples, setSamples] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [partners, setPartners] = useState([]);
    const [dashboardKPIs, setDashboardKPIs] = useState<any>({});
    const [companyProfile, setCompanyProfile] = useState<any>(null);

    // UI & Sync State
    const [itemPage, setItemPage] = useState(1);
    const [itemTotal, setItemTotal] = useState(0);
    const [woPage, setWoPage] = useState(1);
    const [woTotal, setWoTotal] = useState(0);
    const [prPage, setPrPage] = useState(1);
    const [prTotal, setPrTotal] = useState(0);
    const [auditPage, setAuditPage] = useState(1);
    const [auditTotal, setAuditTotal] = useState(0);
    const [reportPage, setReportPage] = useState(1);
    const [reportTotal, setReportTotal] = useState(0);
    const [pageSize] = useState(50);
    const [itemSearch, setItemSearch] = useState('');
    const [itemCategory, setItemCategory] = useState('');
    const [auditType, setAuditType] = useState('');
    const [isInitialLoad, setIsInitialLoad] = useState(true);

    const authFetch = useCallback(async (url: string, options: any = {}) => {
        const token = localStorage.getItem('access_token');
        return fetch(url, { ...options, headers: { ...options.headers, 'Authorization': `Bearer ${token}` } });
    }, []);

    const fetchData = useCallback(async (target?: string) => {
        if (!currentUser) return;
        // In the new routing system, we can use the pathname or a passed target
        const fetchTarget = target || (typeof window !== 'undefined' ? window.location.pathname.substring(1) : 'dashboard') || 'dashboard';
        
        try {
            const token = localStorage.getItem('access_token');
            const headers = { 'Authorization': `Bearer ${token}` };
            const CACHE_KEY = 'terras_master_cache';
            const CACHE_TTL = 3600000; 
            const savedCache = localStorage.getItem(CACHE_KEY);
            let masterFetched = false;

            if (isInitialLoad && savedCache) {
                const parsed = JSON.parse(savedCache);
                if (Date.now() - parsed.timestamp < CACHE_TTL) {
                    const data = parsed.data;
                    setLocations(data.locations || []); setAttributes(data.attributes || []); setCategories(data.categories || []);
                    setUoms(data.uoms || []); setSizes(data.sizes || []); setWorkCenters(data.workCenters || []); setOperations(data.operations || []);
                    setPartners(data.partners || []);
                    setIsInitialLoad(false); masterFetched = true;
                }
            }

            const requests: Promise<any>[] = [];
            const requestTypes: string[] = [];

            // 1. MASTER DATA (Locations, Partners, etc.)
            // Fetch if initial load OR explicitly targeted OR on Settings/Locations page
            if ((isInitialLoad && !masterFetched) || fetchTarget === 'settings' || fetchTarget === 'locations' || fetchTarget === 'item-metadata' || fetchTarget === 'routing') {
                requests.push(fetch(`${API_BASE}/locations`, { headers })); requestTypes.push('locations');
                requests.push(fetch(`${API_BASE}/attributes`, { headers })); requestTypes.push('attributes');
                requests.push(fetch(`${API_BASE}/categories`, { headers })); requestTypes.push('categories');
                requests.push(fetch(`${API_BASE}/uoms`, { headers })); requestTypes.push('uoms');
                requests.push(fetch(`${API_BASE}/sizes`, { headers })); requestTypes.push('sizes');
                requests.push(fetch(`${API_BASE}/work-centers`, { headers })); requestTypes.push('work-centers');
                requests.push(fetch(`${API_BASE}/operations`, { headers })); requestTypes.push('operations');
                requests.push(fetch(`${API_BASE}/partners`, { headers })); requestTypes.push('partners');
                requests.push(fetch(`${API_BASE}/settings/company`, { headers })); requestTypes.push('company-profile');
            }

            // 2. DOMAIN DATA (Inventory, Orders, etc.)
            // Only fetch what matches the current route to minimize load
            
            // Items & Inventory
            if (['dashboard', 'inventory', 'sample-masters', 'bom', 'manufacturing', 'sales-orders', 'purchase-orders', 'stock', 'reports', 'samples'].some(t => fetchTarget.includes(t))) {
                const skip = (itemPage - 1) * pageSize;
                requests.push(fetch(`${API_BASE}/items?skip=${skip}&limit=${pageSize}&search=${encodeURIComponent(itemSearch)}&category=${encodeURIComponent(itemCategory)}`, { headers }));
                requestTypes.push('items');
            }

            // KPIs
            if (fetchTarget === 'dashboard' || fetchTarget === '') {
                requests.push(fetch(`${API_BASE}/dashboard/kpis`, { headers }));
                requestTypes.push('kpis');
            }

            // Engineering
            if (fetchTarget.includes('bom') || fetchTarget.includes('manufacturing') || fetchTarget.includes('samples') || fetchTarget.includes('sales-orders')) {
                requests.push(fetch(`${API_BASE}/boms`, { headers }));
                requestTypes.push('boms');
            }

            // MES (Manufacturing Orders + Production Runs)
            if (fetchTarget.includes('manufacturing') || fetchTarget === 'dashboard' || fetchTarget === '' || fetchTarget.includes('reports')) {
                const moSkip = (woPage - 1) * pageSize;
                requests.push(fetch(`${API_BASE}/manufacturing-orders?skip=${moSkip}&limit=${pageSize}`, { headers }));
                requestTypes.push('manufacturing-orders');
                const prSkip = (prPage - 1) * pageSize;
                requests.push(fetch(`${API_BASE}/production-runs?skip=${prSkip}&limit=${pageSize}`, { headers }));
                requestTypes.push('production-runs');
            }

            // Inventory / Stock
            if (fetchTarget.includes('stock') || fetchTarget === 'dashboard' || fetchTarget === '' || fetchTarget.includes('inventory') || fetchTarget.includes('manufacturing')) {
                requests.push(fetch(`${API_BASE}/stock/balance`, { headers }));
                requestTypes.push('balance');
            }
            
            if (fetchTarget.includes('stock') || fetchTarget.includes('reports')) {
                 const skip = (reportPage - 1) * pageSize;
                 requests.push(fetch(`${API_BASE}/stock?skip=${skip}&limit=${pageSize}`, { headers }));
                 requestTypes.push('stock-ledger');
            }

            // Sales & CRM
            if (fetchTarget.includes('sales-orders') || fetchTarget.includes('samples') || fetchTarget === 'dashboard' || fetchTarget === '' || fetchTarget.includes('customers')) {
                requests.push(fetch(`${API_BASE}/sales-orders`, { headers }));
                requestTypes.push('sales-orders');
                requests.push(fetch(`${API_BASE}/samples`, { headers }));
                requestTypes.push('samples');
            }

            // Procurement
            if (fetchTarget.includes('purchase-orders') || fetchTarget === 'dashboard' || fetchTarget === '' || fetchTarget.includes('suppliers')) {
                requests.push(fetch(`${API_BASE}/purchase-orders`, { headers }));
                requestTypes.push('purchase-orders');
            }

            // Partners (Customers/Suppliers)
            if (fetchTarget.includes('customers') || fetchTarget.includes('suppliers') || fetchTarget.includes('samples') || fetchTarget === 'dashboard' || fetchTarget === '') {
                requests.push(fetch(`${API_BASE}/partners`, { headers }));
                requestTypes.push('partners');
            }

            // Admin / Audit
            if (fetchTarget.includes('audit-logs')) {
                const audSkip = (auditPage - 1) * pageSize;
                requests.push(fetch(`${API_BASE}/audit-logs?skip=${audSkip}&limit=${pageSize}&entity_type=${auditType}`, { headers }));
                requestTypes.push('audit-logs');
            }

            const responses = await Promise.all(requests);
            const newMasterData: any = {};
            for (let i = 0; i < responses.length; i++) {
                const res = responses[i]; const type = requestTypes[i]; if (!res.ok) continue;
                const data = await res.json();
                switch(type) {
                    case 'locations': setLocations(data); newMasterData.locations = data; break;
                    case 'attributes': setAttributes(data); newMasterData.attributes = data; break;
                    case 'categories': setCategories(data); newMasterData.categories = data; break;
                    case 'uoms': setUoms(data); newMasterData.uoms = data; break;
                    case 'sizes': setSizes(data); newMasterData.sizes = data; break;
                    case 'work-centers': setWorkCenters(data); newMasterData.workCenters = data; break;
                    case 'operations': setOperations(data); newMasterData.operations = data; break;
                    case 'partners': setPartners(data); newMasterData.partners = data; break;
                    case 'company-profile': setCompanyProfile(data); newMasterData.companyProfile = data; break;
                    case 'items': setItems(data.items); setItemTotal(data.total); break;
                    case 'kpis': setDashboardKPIs(data); break;
                    case 'boms': setBoms(data); break;
                    case 'manufacturing-orders': setManufacturingOrders(data.items); setWoTotal(data.total); break;
                    case 'production-runs': setProductionRuns(data.items); setPrTotal(data.total); break;
                    case 'balance': setStockBalance(data); break;
                    case 'stock-ledger': setStockEntries(data.items || []); setReportTotal(data.total || 0); break;
                    case 'sales-orders': setSalesOrders(data); break;
                    case 'samples': setSamples(data); break;
                    case 'purchase-orders': setPurchaseOrders(data); break;
                    case 'audit-logs': setAuditLogs(data.items); setAuditTotal(data.total); break;
                }
            }
            if (Object.keys(newMasterData).length > 0) {
                const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{"data":{}}');
                localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: { ...cache.data, ...newMasterData } }));
                setIsInitialLoad(false);
            }
        } catch (e) { console.error("Fetch Error", e); }
    }, [currentUser, itemPage, woPage, prPage, auditPage, reportPage, itemSearch, itemCategory, auditType, isInitialLoad, pageSize]);

    const handleTabHover = (tab: string) => fetchData(tab);

    useEffect(() => { if (currentUser) fetchData(); }, [currentUser, itemPage, woPage, prPage, auditPage, reportPage, itemSearch, itemCategory, auditType, fetchData]);

    // WebSocket Logic
    const fetchDataRef = useRef(fetchData);
    useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);

    useEffect(() => {
        if (!currentUser) return;
        
        // WebSocket logic is safe here as it only runs on client
        const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws/events';
        let ws: WebSocket;
        let reconnectTimer: any;

        const connect = () => {
            ws = new WebSocket(wsUrl);
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    switch (data.type) {
                        case 'WORK_ORDER_UPDATE':
                        case 'MANUFACTURING_ORDER_UPDATE':
                            setManufacturingOrders((prev: any[]) => prev.map((mo: any) =>
                                mo.id === data.mo_id ? { ...mo, status: data.status } : mo
                            ));
                            fetchDataRef.current('/manufacturing');
                            showToast(`Manufacturing Order ${data.code} updated: ${data.status}`, 'info');
                            break;
                        case 'PRODUCTION_RUN_UPDATE':
                            fetchDataRef.current('/manufacturing');
                            break;
                        default:
                            break;
                    }
                } catch (e) { console.error("WS Error", e); }
            };
            ws.onclose = (e) => { if (e.code !== 1000) reconnectTimer = setTimeout(connect, 5000); };
            ws.onerror = () => ws.close();
        };
        connect();
        return () => { if (ws) ws.close(1000); clearTimeout(reconnectTimer); };
    }, [currentUser, showToast]);

    const value = React.useMemo(() => ({
        items, locations, attributes, categories, uoms, sizes, boms, manufacturingOrders, productionRuns,
        stockEntries, stockBalance, workCenters, operations, salesOrders, purchaseOrders, samples, auditLogs,
        partners, dashboardKPIs, companyProfile,
        pagination: { itemPage, setItemPage, itemTotal, woPage, setWoPage, woTotal, prPage, setPrPage, prTotal, auditPage, setAuditPage, auditTotal, reportPage, setReportPage, reportTotal, pageSize },
        filters: { itemSearch, setItemSearch, itemCategory, setItemCategory, auditType, setAuditType },
        fetchData, handleTabHover, authFetch
    }), [
        items, locations, attributes, categories, uoms, sizes, boms, manufacturingOrders, productionRuns,
        stockEntries, stockBalance, workCenters, operations, salesOrders, purchaseOrders, samples, auditLogs,
        partners, dashboardKPIs, companyProfile,
        itemPage, itemTotal, woPage, woTotal, prPage, prTotal, auditPage, auditTotal, reportPage, reportTotal, pageSize,
        itemSearch, itemCategory, auditType, fetchData, handleTabHover, authFetch
    ]);

    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export const useData = () => {
    const context = useContext(DataContext);
    if (!context) throw new Error('useData must be used within DataProvider');
    return context;
};
