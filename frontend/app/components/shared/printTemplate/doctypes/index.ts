/**
 * The record-based print documents, in one list.
 *
 * Every consumer — field manifests and resolution (fieldRegistry), table row
 * sources (rowSources), built-in layouts and designer labels (templateStore), and
 * the designer's preview records (PrintDesignerView) — reads this list, so porting
 * a document is: its `doctypes/<doc>.ts`, its `defaults/<doc>.ts`, one entry here,
 * and the print modal. The Kartu Kerja family predates this and keeps its own
 * wiring (WO-shaped context, work-centre dispatch).
 */

import type { FieldDef, ResolvedField } from '../fieldRegistry';
import type { RowSourceDef } from '../rowSources';
import type { PrintContext } from '../renderContext';
import type { PrintLayout } from '../types';

import { SURAT_JALAN_DOC, SJ_FIELDS, SJ_ROW_SOURCES, resolveSuratJalanField, buildSuratJalanContext } from './suratJalan';
import { PURCHASE_ORDER_DOC, PO_FIELDS, PO_ROW_SOURCES, resolvePurchaseOrderField, buildPurchaseOrderContext } from './purchaseOrder';
import { SALES_ORDER_DOC, SO_FIELDS, SO_ROW_SOURCES, resolveSalesOrderField, buildSalesOrderContext } from './salesOrder';
import { SURAT_JALAN_DEFAULT } from '../defaults/suratJalan';
import { PURCHASE_ORDER_DEFAULT } from '../defaults/purchaseOrder';
import { SALES_ORDER_DEFAULT } from '../defaults/salesOrder';
import { STOCK_LEDGER_DOC, SL_FIELDS, SL_ROW_SOURCES, resolveStockLedgerField, buildStockLedgerContext } from './stockLedger';
import { STOCK_LEDGER_DEFAULT } from '../defaults/stockLedger';
import { SO_TABLE_DOC, ST_FIELDS, ST_ROW_SOURCES, resolveSoTableField, buildSoTableContext } from './soTable';
import { SO_TABLE_DEFAULT } from '../defaults/soTable';

/** What the designer has on hand to build a preview context from a sample record. */
export interface SampleEnv {
    partners: any[];
    itemIndex: Record<string, any> | null;
    attributes: any[];
    companyProfile: any;
    companyName?: string;
    companyLogoUrl?: string;
    tzFormatCustom: (iso: string, opts: Intl.DateTimeFormatOptions, locale?: string) => string;
    customerAddr: (customerName: string) => string;
}

/** Where the designer gets records to preview a document with. */
export interface SampleSource {
    /** Plural noun for the picker's loading / empty text. */
    noun: string;
    /** API path (under API_BASE) of a recent set. */
    list: string;
    /** Records out of the list response. Default: `body.items ?? body`. */
    extract?: (body: any) => any[];
    /** Path to fetch one deep-linked record missing from `list` — by id, or by the
     *  link's `q` search term where the API has no single-record route. */
    find?: (id: string, q: string) => string | null;
    /** Picker label. */
    label: (record: any, env: SampleEnv) => string;
    /** Preview context for one record. */
    build: (record: any, env: SampleEnv) => PrintContext;
}

export interface DocTypeModule {
    docType: string;
    label: string;
    /** Field keys this module resolves, e.g. 'sj.' — dispatch is by prefix. */
    fieldPrefix: string;
    fields: FieldDef[];
    resolve: (key: string, ctx: PrintContext) => ResolvedField;
    rowSources: RowSourceDef[];
    defaultLayout: PrintLayout;
    sample: SampleSource;
}

export const DOC_MODULES: DocTypeModule[] = [
    {
        docType: SURAT_JALAN_DOC,
        label: 'Surat Jalan (delivery note)',
        fieldPrefix: 'sj.',
        fields: SJ_FIELDS,
        resolve: resolveSuratJalanField,
        rowSources: SJ_ROW_SOURCES,
        defaultLayout: SURAT_JALAN_DEFAULT,
        sample: {
            noun: 'shipments',
            list: '/shipments?page=1&size=20',
            find: id => `/shipments/${id}`,
            label: x => `${x.delivery_note_number || x.code} — ${x.customer_name || 'no customer'}`,
            build: (x, env) => buildSuratJalanContext({
                shipment: x, itemIndex: env.itemIndex, attributes: env.attributes, customerAddr: env.customerAddr,
                companyName: env.companyName, companyLogoUrl: env.companyLogoUrl, companyProfile: env.companyProfile,
                tzFormatCustom: env.tzFormatCustom,
            }),
        },
    },
    {
        docType: PURCHASE_ORDER_DOC,
        label: 'Purchase Order',
        fieldPrefix: 'po.',
        fields: PO_FIELDS,
        resolve: resolvePurchaseOrderField,
        rowSources: PO_ROW_SOURCES,
        defaultLayout: PURCHASE_ORDER_DEFAULT,
        sample: {
            noun: 'purchase orders',
            list: '/purchase-orders?page=1&size=20',
            // No single-PO route; the preview's link carries the PO number to search by.
            find: (_id, q) => (q ? `/purchase-orders?search=${encodeURIComponent(q)}&page=1&size=5` : null),
            label: (x, env) => `${x.po_number} — ${(env.partners || []).find((p: any) => p.id === x.supplier_id)?.name || 'no supplier'}`,
            build: (x, env) => buildPurchaseOrderContext({
                po: x, partners: env.partners, itemIndex: env.itemIndex, attributes: env.attributes,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: SALES_ORDER_DOC,
        label: 'Sales Order Confirmation',
        fieldPrefix: 'so.',
        fields: SO_FIELDS,
        resolve: resolveSalesOrderField,
        rowSources: SO_ROW_SOURCES,
        defaultLayout: SALES_ORDER_DEFAULT,
        sample: {
            noun: 'sales orders',
            list: '/sales-orders?page=1&size=20',
            find: (_id, q) => (q ? `/sales-orders?search=${encodeURIComponent(q)}&page=1&size=5` : null),
            label: x => `${x.po_number} — ${x.customer_name || 'no customer'}`,
            build: (x, env) => buildSalesOrderContext({
                so: x, partners: env.partners, itemIndex: env.itemIndex, attributes: env.attributes,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: STOCK_LEDGER_DOC,
        label: 'Stock Ledger report',
        fieldPrefix: 'sl.',
        fields: SL_FIELDS,
        resolve: resolveStockLedgerField,
        rowSources: SL_ROW_SOURCES,
        defaultLayout: STOCK_LEDGER_DEFAULT,
        sample: {
            noun: 'ledger movements',
            list: '/stock?page=1&size=50',
            // A report prints a filtered set, not one record: the preview is one
            // synthetic "record" holding the latest page and the server's totals.
            extract: body => [{
                id: 'recent', rows: body.items || [], total: body.total ?? 0,
                totalIn: body.total_in ?? 0, totalOut: body.total_out ?? 0,
            }],
            label: x => `Latest ${x.rows.length} of ${Number(x.total).toLocaleString()} movements`,
            build: (x, env) => buildStockLedgerContext({
                entries: x.rows, attributes: env.attributes, periodLabel: 'All time → now',
                totals: { total: x.total, totalIn: x.totalIn, totalOut: x.totalOut },
                formatDateTime: iso => env.tzFormatCustom(iso, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: SO_TABLE_DOC,
        label: 'Sales Order table report',
        fieldPrefix: 'st.',
        fields: ST_FIELDS,
        resolve: resolveSoTableField,
        rowSources: ST_ROW_SOURCES,
        defaultLayout: SO_TABLE_DEFAULT,
        sample: {
            noun: 'sales orders',
            list: '/sales-orders?page=1&size=50',
            // One synthetic "record": the latest page of orders, as the list would print it.
            extract: body => [{ id: 'recent', orders: body.items || [] }],
            label: x => `Latest ${x.orders.length} sales orders`,
            build: (x, env) => buildSoTableContext({
                salesOrders: x.orders, itemIndex: env.itemIndex, attributes: env.attributes,
                tzFormatCustom: env.tzFormatCustom,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
];

export const DOC_MODULE_BY_TYPE: Record<string, DocTypeModule> =
    Object.fromEntries(DOC_MODULES.map(m => [m.docType, m]));

/** The module whose field prefix owns `key`, if any. */
export function moduleForField(key: string): DocTypeModule | undefined {
    return DOC_MODULES.find(m => key.startsWith(m.fieldPrefix));
}
