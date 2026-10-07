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
import { BAG_LABEL_DOC, BEAM_LABEL_DOC, OUTLABEL_FIELDS, OUTLABEL_ROW_SOURCES, resolveOutputLabelField, buildOutputLabelContext, outputLabelSampleRecords } from './outputLabel';
import { BAG_LABEL_DEFAULT, BEAM_LABEL_DEFAULT } from '../defaults/outputLabel';
import { LOT_LABEL_DOC, LOTLABEL_FIELDS, resolveLotLabelField, buildLotLabelContext } from './lotLabel';
import { LOT_LABEL_DEFAULT } from '../defaults/lotLabel';
import { PACKED_UNIT_LABEL_DOC, CARTON_FIELDS, CARTON_ROW_SOURCES, resolveCartonLabelField, buildCartonLabelContext } from './packedUnitLabel';
import { PACKED_UNIT_LABEL_DEFAULT } from '../defaults/packedUnitLabel';
import { PACKING_CARD_DOC, PCARD_FIELDS, PCARD_ROW_SOURCES, resolvePackingCardField, buildPackingCardContext } from './packingCard';
import { PACKING_CARD_DEFAULT } from '../defaults/packingCard';
import { PICK_LIST_DOC, PLIST_FIELDS, PLIST_ROW_SOURCES, resolvePickListField, buildPickListContext } from './pickList';
import { PICK_LIST_DEFAULT } from '../defaults/pickList';
import { SAMPLE_REQUEST_DOC, SR_FIELDS, SR_ROW_SOURCES, resolveSampleRequestField, buildSampleRequestContext } from './sampleRequest';
import { SAMPLE_REQUEST_DEFAULT } from '../defaults/sampleRequest';
import { PR_PULL_SHEET_DOC, PR_FIELDS, PR_ROW_SOURCES, resolvePRPullSheetField, buildPRPullSheetContext } from './prPullSheet';
import { PR_PULL_SHEET_DEFAULT } from '../defaults/prPullSheet';
import { DYE_RECIPE_DOC, DR_FIELDS, DR_ROW_SOURCES, resolveDyeRecipeField, buildDyeRecipeContext } from './dyeRecipe';
import { DYE_RECIPE_DEFAULT } from '../defaults/dyeRecipe';
import { BOM_SHEET_DOC, BS_FIELDS, BS_ROW_SOURCES, resolveBomSheetField, buildBomSheetContext } from './bomSheet';
import { BOM_SHEET_DEFAULT } from '../defaults/bomSheet';
import { MO_SHEET_DOC, MS_FIELDS, MS_ROW_SOURCES, resolveMoSheetField, buildMoSheetContext } from './moSheet';
import { MO_SHEET_DEFAULT } from '../defaults/moSheet';

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
    /** Path to a second read the real print modal also makes (e.g. a run's material
     *  requirements); its body reaches `build` as `detail`, undefined while loading. */
    detail?: (record: any) => string | null;
    /** Preview context for one record. */
    build: (record: any, env: SampleEnv, detail?: any) => PrintContext;
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
                entries: x.rows, periodLabel: 'All time → now',
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
    // Bag and beam labels share one field set (and so the `outlabel.` prefix); the
    // preview record is a completion carrying its MO/WO. The modal's link `q` is the
    // MO id, the only route that yields a completion.
    ...[BAG_LABEL_DOC, BEAM_LABEL_DOC].map((docType): DocTypeModule => {
        const beams = docType === BEAM_LABEL_DOC;
        return {
            docType,
            label: beams ? 'Warp beam label' : 'Bag output label',
            fieldPrefix: 'outlabel.',
            fields: OUTLABEL_FIELDS,
            resolve: resolveOutputLabelField,
            rowSources: OUTLABEL_ROW_SOURCES,
            defaultLayout: beams ? BEAM_LABEL_DEFAULT : BAG_LABEL_DEFAULT,
            sample: {
                noun: beams ? 'beams' : 'bags',
                list: '/manufacturing-orders?all_levels=true&limit=40',
                extract: body => outputLabelSampleRecords(body, beams),
                find: (_id, q) => (q ? `/manufacturing-orders/${q}` : null),
                label: x => `${x.output_batch_number} — ${x._mo?.code || ''}`,
                build: (x, env) => buildOutputLabelContext({
                    completion: x, workOrder: x._wo, parentMO: x._mo, bagSeq: beams ? null : x._seq,
                    attributes: env.attributes, tzFormatCustom: env.tzFormatCustom,
                    companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
                }),
            },
        };
    }),
    {
        docType: LOT_LABEL_DOC,
        label: 'Lot label',
        fieldPrefix: 'lotlabel.',
        fields: LOTLABEL_FIELDS,
        resolve: resolveLotLabelField,
        rowSources: [],
        defaultLayout: LOT_LABEL_DEFAULT,
        sample: {
            noun: 'lots',
            list: '/batches/paginated?page=1&size=20',
            find: (_id, q) => (q ? `/batches/paginated?search=${encodeURIComponent(q)}&page=1&size=5` : null),
            label: x => `${x.batch_number} — ${x.item_name || x.item_code || ''}`,
            build: (x, env) => buildLotLabelContext({
                lot: x, tzFormatCustom: env.tzFormatCustom,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: PACKED_UNIT_LABEL_DOC,
        label: 'Carton label',
        fieldPrefix: 'carton.',
        fields: CARTON_FIELDS,
        resolve: resolveCartonLabelField,
        rowSources: CARTON_ROW_SOURCES,
        defaultLayout: PACKED_UNIT_LABEL_DEFAULT,
        sample: {
            noun: 'cartons',
            // Cartons ride on their packing order (the label reads the order's PO
            // ref, units and completions), so each sample carries its order along.
            list: '/packing?page=1&size=20',
            extract: body => (body.items ?? [body]).flatMap((o: any) =>
                (o.packed_units || []).map((u: any) => ({ ...u, _order: o }))),
            // The preview's link carries the packing order id as `q`.
            find: (_id, q) => (q ? `/packing/${q}` : null),
            label: x => `${x.batch_number} — ${x._order?.code || ''}`,
            build: (x, env) => buildCartonLabelContext({
                po: x._order, unit: x, tzFormatCustom: env.tzFormatCustom,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: PACKING_CARD_DOC,
        label: 'Kartu Packing (packing order card)',
        fieldPrefix: 'pcard.',
        fields: PCARD_FIELDS,
        resolve: resolvePackingCardField,
        rowSources: PCARD_ROW_SOURCES,
        defaultLayout: PACKING_CARD_DEFAULT,
        sample: {
            noun: 'packing orders',
            list: '/packing?page=1&size=20',
            find: id => `/packing/${id}`,
            label: x => `${x.code} — ${x.item_name || x.item_code || ''}`,
            build: (x, env) => buildPackingCardContext({
                po: x, attributes: env.attributes, tzFormatCustom: env.tzFormatCustom,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: PICK_LIST_DOC,
        label: 'Kartu Picking (pick list card)',
        fieldPrefix: 'plist.',
        fields: PLIST_FIELDS,
        resolve: resolvePickListField,
        rowSources: PLIST_ROW_SOURCES,
        defaultLayout: PICK_LIST_DEFAULT,
        sample: {
            noun: 'pick lists',
            list: '/pick-lists?page=1&size=20',
            find: id => `/pick-lists/${id}`,
            label: x => `${x.code} — ${x.customer_name || 'no customer'}`,
            build: (x, env) => buildPickListContext({
                pl: x, tzFormatCustom: env.tzFormatCustom,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: SAMPLE_REQUEST_DOC,
        label: 'SPK Sample',
        fieldPrefix: 'sr.',
        fields: SR_FIELDS,
        resolve: resolveSampleRequestField,
        rowSources: SR_ROW_SOURCES,
        defaultLayout: SAMPLE_REQUEST_DEFAULT,
        sample: {
            noun: 'sample requests',
            list: '/samples?page=1&size=20',
            // No single-sample route; the preview's link carries the SPK code to search by.
            find: (_id, q) => (q ? `/samples?search=${encodeURIComponent(q)}&page=1&size=5` : null),
            label: (x, env) => `${x.code} — ${(env.partners || []).find((p: any) => p.id === x.customer_id)?.name || x.project || 'no customer'}`,
            build: (x, env) => buildSampleRequestContext({
                sample: x, customerName: (env.partners || []).find((p: any) => p.id === x.customer_id)?.name || '',
                tzFormatCustom: env.tzFormatCustom,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: PR_PULL_SHEET_DOC,
        label: 'Material Pull Sheet (production run)',
        fieldPrefix: 'pr.',
        fields: PR_FIELDS,
        resolve: resolvePRPullSheetField,
        rowSources: PR_ROW_SOURCES,
        defaultLayout: PR_PULL_SHEET_DEFAULT,
        sample: {
            noun: 'production runs',
            list: '/production-runs?page=1&size=20',
            find: (_id, q) => (q ? `/production-runs?search=${encodeURIComponent(q)}&page=1&size=5` : null),
            label: x => `${x.code}${x.sales_order_code ? ` — ${x.sales_order_code}` : ''}`,
            // The requirement rows come from a second, per-run endpoint, the one the
            // print modal calls — without it the preview read "No component requirements".
            detail: x => (x?.id ? `/production-runs/${x.id}/material-requirements` : null),
            build: (x, env, reqs) => buildPRPullSheetContext({
                pr: x, reqs: Array.isArray(reqs) ? reqs : [], isLoading: !!x?.id && reqs === undefined,
                getLocationName: () => '',
                getAttributeValueName: (id: any) => {
                    for (const a of env.attributes || []) { const v = a.values?.find((y: any) => y.id === id); if (v) return v.value; }
                    return '';
                },
                formatDate: (d: any) => (d ? env.tzFormatCustom(d, {}) : '-'),
                tzFormatCustom: env.tzFormatCustom,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: DYE_RECIPE_DOC,
        label: 'Kartu Celup (dye recipe)',
        fieldPrefix: 'dr.',
        fields: DR_FIELDS,
        resolve: resolveDyeRecipeField,
        rowSources: DR_ROW_SOURCES,
        defaultLayout: DYE_RECIPE_DEFAULT,
        sample: {
            noun: 'dye recipes',
            list: '/dye-recipes?page=1&size=20',
            find: (_id, q) => (q ? `/dye-recipes?search=${encodeURIComponent(q)}&page=1&size=5` : null),
            label: x => `${x.code} — ${x.name}`,
            build: (x, env) => buildDyeRecipeContext({
                recipe: x, tzFormatCustom: env.tzFormatCustom,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: BOM_SHEET_DOC,
        label: 'Bill of Materials',
        fieldPrefix: 'bs.',
        fields: BS_FIELDS,
        resolve: resolveBomSheetField,
        rowSources: BS_ROW_SOURCES,
        defaultLayout: BOM_SHEET_DEFAULT,
        sample: {
            noun: 'BOMs',
            // Summary rows carry the full header, lines and sizes — all the sheet prints.
            list: '/boms/summary?page=1&size=20',
            find: (_id, q) => (q ? `/boms/summary?search=${encodeURIComponent(q)}&page=1&size=5` : null),
            label: x => `${x.code} — ${x.item_name || x.item_code || ''}`,
            build: (x, env) => buildBomSheetContext({
                bom: x, attributes: env.attributes, tzFormatCustom: env.tzFormatCustom,
                companyProfile: env.companyProfile, companyName: env.companyName, companyLogoUrl: env.companyLogoUrl,
            }),
        },
    },
    {
        docType: MO_SHEET_DOC,
        label: 'SPK Produksi (manufacturing order)',
        fieldPrefix: 'ms.',
        fields: MS_FIELDS,
        resolve: resolveMoSheetField,
        rowSources: MS_ROW_SOURCES,
        defaultLayout: MO_SHEET_DEFAULT,
        sample: {
            noun: 'manufacturing orders',
            list: '/manufacturing-orders?all_levels=true&limit=40',
            find: id => `/manufacturing-orders/${id}`,
            label: x => `${x.code} — ${x.item_name || ''}`,
            // Each MO carries its own BOM, so the preview explodes one level; the page
            // print also walks sub-BOMs from its BOM list.
            build: (x, env) => buildMoSheetContext({
                mo: x, attributes: env.attributes, tzFormatCustom: env.tzFormatCustom,
                getItemName: id => env.itemIndex?.[String(id)]?.name || '',
                getItemCode: id => env.itemIndex?.[String(id)]?.code || '',
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
