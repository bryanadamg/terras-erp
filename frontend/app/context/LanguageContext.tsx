'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'id';

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
}

const translations = {
    en: {
        'dashboard': 'Dashboard',
        // Sidebar
        'inventory': 'Inventory',
        'item_inventory': 'Item Inventory',
        'sample_masters': 'Sample Masters',
        'attributes': 'Attributes',
        'categories': 'Categories',
        'locations': 'Locations',
        'sales': 'Sales',
        'procurement': 'Procurement',
        'sales_orders': 'Sales Orders (SO)',
        'customers': 'Customers',
        'suppliers': 'Suppliers',
        'purchase_orders': 'Purchase Orders (PO)',
        'sample_requests': 'Sample Requests',
        'engineering': 'Engineering',
        'bom': 'Bill of Materials',
        'production_calendar': 'Production Calendar',
        'routing': 'Routing & Ops',
        'work_orders': 'Work Orders',
        'manufacturing_orders': 'Manufacturing Orders',
        'stock_adjustment': 'Stock Adjustment',
        'stock_on_hand': 'Stock On-Hand',
        'reports': 'Reports',
        'stock_ledger': 'Stock Ledger',
        'settings': 'Settings',
        'account_settings': 'Account Settings',
        
        // Common
        'create': 'Create',
        'save': 'Save',
        'delete': 'Delete',
        'cancel': 'Cancel',
        'edit': 'Edit',
        'add': 'Add',
        'refresh': 'Refresh',
        'print': 'Print',
        'search': 'Search',
        'actions': 'Actions',
        'status': 'Status',
        'logout': 'Logout',
        'qty': 'Qty',
        'date': 'Date',
        'from': 'From',
        'to': 'To',
        
        // Locations
        'location_code': 'Code',
        'location_name': 'Name',

        // Items
        'item_code': 'Item Code',
        'item_name': 'Item Name',
        'uom': 'UOM',
        'source_sample': 'Source Sample',
        'weight_per_unit': 'Weight / Unit',
        
        // Manufacturing
        'production_schedule': 'Production Schedule',
        'new_production_run': 'New Production Run',
        'select_recipe': 'Select Recipe',
        'production_location': 'Production Location',
        'due_date': 'Due Date',
        'start': 'Start',
        'finish': 'Finish',
        'pending': 'PENDING',
        'in_progress': 'IN PROGRESS',
        'completed': 'COMPLETED',
        'cancelled': 'CANCELLED',
        
        // BOM
        'active_boms': 'Active BOMs',
        'create_recipe': 'Create Recipe',
        'finished_good': 'Finished Good',
        'materials': 'Materials',
        'routing_operations': 'Routing & Operations',
        
        // Routing
        'work_centers': 'Work Centers',
        'standard_operations': 'Standard Operations',
        'station_name': 'Station Name',
        'operation_name': 'Operation Name',
        
        // Headers
        'powered_by': 'Powered by',
    },
    id: {
        'dashboard': 'Dasbor',
        // Sidebar
        'inventory': 'Inventaris',
        'item_inventory': 'Daftar Barang',
        'sample_masters': 'Master Sampel',
        'attributes': 'Atribut',
        'categories': 'Kategori',
        'locations': 'Lokasi',
        'sales': 'Penjualan',
        'procurement': 'Pengadaan',
        'sales_orders': 'Pesanan Penjualan (SO)',
        'customers': 'Pelanggan',
        'suppliers': 'Pemasok',
        'purchase_orders': 'Pesanan Pembelian (PO)',
        'sample_requests': 'Permintaan Sampel',
        'engineering': 'Teknik',
        'bom': 'Resep Produksi (BOM)',
        'production_calendar': 'Kalender Produksi',
        'work_orders': 'Perintah Kerja (WO)',
        'manufacturing_orders': 'Perintah Produksi (MO)',
        'routing': 'Routing & Operasi',
        'stock_adjustment': 'Penyesuaian Stok',
        'stock_on_hand': 'Stok Tersedia',
        'reports': 'Laporan',
        'stock_ledger': 'Buku Besar Stok',
        'settings': 'Pengaturan',
        'account_settings': 'Pengaturan Akun',
        
        // Common
        'create': 'Buat',
        'save': 'Simpan',
        'delete': 'Hapus',
        'cancel': 'Batal',
        'edit': 'Ubah',
        'add': 'Tambah',
        'refresh': 'Segarkan',
        'print': 'Cetak',
        'search': 'Cari',
        'actions': 'Aksi',
        'status': 'Status',
        'logout': 'Keluar',
        'qty': 'Jml',
        'date': 'Tanggal',
        'from': 'Dari',
        'to': 'Sampai',
        
        // Locations
        'location_code': 'Kode',
        'location_name': 'Nama',

        // Items
        'item_code': 'Kode Barang',
        'item_name': 'Nama Barang',
        'uom': 'Satuan',
        'source_sample': 'Sampel Sumber',
        'weight_per_unit': 'Berat / Satuan',
        
        // Manufacturing
        'production_schedule': 'Jadwal Produksi',
        'new_production_run': 'Jalan Produksi Baru',
        'select_recipe': 'Pilih Resep',
        'production_location': 'Lokasi Produksi',
        'due_date': 'Tenggat Waktu',
        'start': 'Mulai',
        'finish': 'Selesai',
        'pending': 'TUNDA',
        'in_progress': 'DIPROSES',
        'completed': 'SELESAI',
        'cancelled': 'BATAL',
        
        // BOM
        'active_boms': 'Daftar Resep Aktif',
        'create_recipe': 'Buat Resep',
        'finished_good': 'Barang Jadi',
        'materials': 'Bahan Baku',
        'routing_operations': 'Alur & Operasi',
        
        // Routing
        'work_centers': 'Pusat Kerja (Stasiun)',
        'standard_operations': 'Operasi Standar',
        'station_name': 'Nama Stasiun',
        'operation_name': 'Nama Operasi',
        
        // Headers
        'powered_by': 'Ditenagai oleh',
    }
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [language, setLanguage] = useState<Language>('en');

    useEffect(() => {
        const savedLang = localStorage.getItem('app_language') as Language;
        if (savedLang && (savedLang === 'en' || savedLang === 'id')) {
            setLanguage(savedLang);
        }
    }, []);

    const handleSetLanguage = (lang: Language) => {
        setLanguage(lang);
        localStorage.setItem('app_language', lang);
    };

    const t = (key: string) => {
        return translations[language][key as keyof typeof translations['en']] || key;
    };

    return (
        <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
}

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) throw new Error('useLanguage must be used within LanguageProvider');
    return context;
};
