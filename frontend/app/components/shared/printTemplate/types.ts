/**
 * Print template layout types.
 *
 * A layout is an ordered list of BANDS stacked vertically down the page. Bands
 * flow — they are never absolutely positioned — which is what keeps variable-row
 * tables (BOM components, ledger rows) paginating correctly. Freedom lives
 * *inside* a band: `grid` bands place fields on a 12-column grid, `keyvalue`
 * bands order label/value rows, `table` bands pick and size columns.
 *
 * The backend stores this untouched (see api/print_templates.py). This file and
 * TemplateRenderer.tsx are the only interpreters.
 */

export type Align = 'left' | 'center' | 'right';

/**
 * How one field is styled. Shared by standalone grid cells and by fields inside a
 * stacked cell.
 */
export interface FieldSpec {
    /** Field key from the doc type's registry (see fieldRegistry.ts). */
    field: string;
    fontSize?: number;
    bold?: boolean;
    mono?: boolean;
    align?: Align;
    color?: string;
    /** Uppercase mini-label drawn above the value (the "QTY (KG)" caption style). */
    showLabel?: boolean;
    /** Override the registry's label text. */
    label?: string;
    /** Override the registry's unit suffix; '' removes it. */
    unit?: string;
    /** Clamp long values to N lines (0/undefined = no clamp). */
    maxLines?: number;
    /**
     * Omit the item entirely when the value resolves empty, instead of printing an
     * em dash. Use for optional chrome (a company name on an unbranded card) where
     * a dash would read as a misprint.
     */
    hideWhenEmpty?: boolean;
    /** `qr` fields only: rendered pixel size and the caption under it. */
    qrSize?: number;
    qrCaption?: string;
}

/**
 * A positioned cell in a `grid` band. Holds either a single field or a vertical
 * `stack` of them.
 *
 * The stack exists because CSS grid cannot put a tall item beside a tight column of
 * short ones: a row-spanning cell distributes its height across the rows it spans,
 * so a 140px QR next to three text lines stretched each line to ~53px apart. A
 * stack keeps those lines in ONE cell at their natural spacing, with the QR in a
 * sibling cell on the same row.
 */
export interface GridItem extends Omit<FieldSpec, 'field'> {
    /** The field rendered in this cell. Ignored (and optional) when `stack` is set. */
    field?: string;
    /** 1-based column start on the 12-col grid. */
    col: number;
    /** Column count, 1..12. */
    span: number;
    /** 1-based row. Items sharing a row sit side by side. */
    row: number;
    rowSpan?: number;
    /**
     * When present, `field` is ignored and these render stacked top-to-bottom in
     * this one cell.
     */
    stack?: FieldSpec[];
    /** Gap between stacked fields, px. */
    stackGap?: number;
}

/** A label/value row inside a `keyvalue` band. */
export interface KeyValueRow {
    field: string;
    /** Label cell text. Falls back to the registry label. */
    label?: string;
    /** How many value columns this row's value spans (1..3). */
    span?: number;
    bold?: boolean;
    fontSize?: number;
    /** Drop the row entirely when the value resolves empty (conditional rows). */
    hideWhenEmpty?: boolean;
    /** Draw an underline in the value cell for hand-written entry. */
    fill?: boolean;
    unit?: string;
}

/** A column inside a `table` band. */
export interface TableColumn {
    /** Column key exposed by the band's row source (see rowSources.ts). */
    field: string;
    label: string;
    width?: string;
    align?: Align;
    bold?: boolean;
    decimals?: number;
    /**
     * What to print when the value is null. Defaults to an em dash. Columns the
     * operator fills in by hand (e.g. "Aktual" before anything is logged) set ''
     * so the cell prints blank rather than dashed.
     */
    emptyText?: string;
}

/** A column inside a `tally` band (the hand-fill grids). */
export interface TallyColumn {
    label: string;
    width?: string;
    /** Pre-print the row number in this column instead of leaving it blank. */
    autoNumber?: boolean;
}

interface BandBase {
    id: string;
    /** Band visibility. Hidden bands stay in the layout so toggling is lossless. */
    show?: boolean;
    /**
     * Small caption above the band. The literal `'{auto}'` defers to the row
     * source's suggested title (see rowSources.ts).
     */
    title?: string;
    titleUppercase?: boolean;
    /** Space below the band, px. */
    marginBottom?: number;
    /** CSS border shorthand drawn around the band. */
    box?: string;
    /** CSS border shorthand drawn under the band. */
    borderBottom?: string;
    /** CSS border shorthand drawn above the band. */
    borderTop?: string;
    padding?: string;
}

export interface GridBand extends BandBase {
    type: 'grid';
    items: GridItem[];
    /** Row gap / column gap, px. */
    gap?: number;
    /** Draw each item in its own bordered cell (the Qty/Ends metric-box look). */
    cellBox?: string;
    /** Vertical alignment of items within their grid rows. */
    alignItems?: 'start' | 'center' | 'end';
}

export interface KeyValueBand extends BandBase {
    type: 'keyvalue';
    rows: KeyValueRow[];
    /** Width of the label column, e.g. '24%'. */
    labelWidth?: string;
    labelFontSize?: number;
    valueFontSize?: number;
}

export interface TableBand extends BandBase {
    type: 'table';
    /** Row source id from rowSources.ts. */
    source: string;
    columns: TableColumn[];
    fontSize?: number;
    /** Hide the whole band when the source yields no rows. */
    hideWhenEmpty?: boolean;
}

export interface TallyBand extends BandBase {
    type: 'tally';
    columns: TallyColumn[];
    rows: number;
    fontSize?: number;
    /** Cell min-height in px — controls how much room the operator gets to write. */
    cellHeight?: number;
    /**
     * Numbered-box variant (the "Cek / 10 mnt" grid): ignores `columns` and draws
     * `rows * boxesPerRow` sequentially numbered write-in boxes.
     */
    boxes?: number;
    boxesPerRow?: number;
    /** Trailing summary row: e.g. { label: 'Jumlah', totalLabel: 'Total' }. */
    totalRow?: { label: string; totalLabel?: string };
}

export interface SignatureBand extends BandBase {
    type: 'signature';
    /** Small print in the bottom-left (traceability footer). */
    footerFields?: { field: string; fontSize?: number }[];
    boxes: { caption: string; width?: number; height?: number }[];
}

export interface SpacerBand extends BandBase {
    type: 'spacer';
    /** Minimum height, px. Grows to fill remaining page height. */
    minHeight?: number;
}

export type Band =
    | GridBand
    | KeyValueBand
    | TableBand
    | TallyBand
    | SignatureBand
    | SpacerBand;

/** The discriminator on its own — for menus and factories over band types. */
export type BandType = Band['type'];

export type PaperSize = 'A4' | 'A5' | 'A6' | 'custom';

export interface PaperSpec {
    size: PaperSize;
    /**
     * `custom` only: the sheet as quoted in PORTRAIT, mm. `orientation` swaps them at
     * render time, so flipping orientation never rewrites these. Ignored (but kept,
     * so switching back to custom remembers them) for named sizes. Resolve both
     * through `paper.ts` — never read these fields raw.
     */
    widthMm?: number;
    heightMm?: number;
    orientation: 'portrait' | 'landscape';
    marginMm: number;
}

export interface PrintLayout {
    /** Bumped only on breaking shape changes; the renderer migrates forward. */
    version: 1;
    paper: PaperSpec;
    /** Base font family + colour for the whole document. */
    fontFamily?: string;
    /**
     * Inset between the paper edge and the document content, mm. This is *on top of*
     * the printer's page margin (`paper.marginMm`) — the page margin is what the
     * printer cannot reach, this is breathing room the design asks for.
     */
    paddingMm?: number;
    bands: Band[];
}

/** What a saved template looks like coming back from the API. */
export interface PrintTemplateRecord {
    id: string;
    doc_type: string;
    layout: PrintLayout;
    paper: PaperSpec | null;
    updated_by_id: string | null;
    updated_at: string;
}
