'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface SamplePrintSettings {
    preparedBy: string;
    preparedRole: string;
    showSampleBox: boolean;
    showChecklist: boolean;
}

const DEFAULT_SETTINGS: SamplePrintSettings = {
    preparedBy: '',
    preparedRole: 'Marketing',
    showSampleBox: true,
    showChecklist: true,
};

const SETTINGS_KEY = 'smp_print_settings';

// ── Small helpers ──────────────────────────────────────────────────────────────
function Checkbox({ checked }: { checked: boolean }) {
    return (
        <span style={{
            display: 'inline-block', width: 13, height: 13,
            border: '1px solid #000', marginRight: 2, verticalAlign: 'middle',
            background: checked ? '#000' : '#fff', flexShrink: 0,
        }} />
    );
}

function FieldRow({ label, value, tall }: { label: string; value?: string | null; tall?: boolean }) {
    return (
        <tr>
            <td style={{ border: '1px solid #555', padding: '4px 7px', fontWeight: 'bold', whiteSpace: 'nowrap', width: '38%', verticalAlign: tall ? 'top' : 'middle' }}>
                {label}
            </td>
            <td style={{ border: '1px solid #555', padding: '4px 7px', verticalAlign: tall ? 'top' : 'middle', minHeight: tall ? 36 : undefined }}>
                {value || ''}
            </td>
        </tr>
    );
}

// ── Document content ──────────────────────────────────────────────────────────
function SPKDocument({
    sample,
    companyProfile,
    getCustomerName,
    settings,
}: {
    sample: any;
    companyProfile: any;
    getCustomerName: (id: string) => string;
    settings: SamplePrintSettings;
}) {
    const { preparedBy, preparedRole, showSampleBox, showChecklist } = settings;

    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace(/\/api$/, '');
    const customerName = sample.customer_id ? getCustomerName(sample.customer_id) : '';
    const colors: any[] = sample.colors || [];

    // Always show at least 5 color rows total (pad with blanks)
    const MIN_COLOR_ROWS = Math.max(5, colors.length + 1);
    const colorRows = [
        ...colors,
        ...Array(Math.max(0, MIN_COLOR_ROWS - colors.length)).fill(null),
    ];

    const docStyle: React.CSSProperties = {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '13px',
        color: '#000',
        lineHeight: '1.4',
    };

    const tableStyle: React.CSSProperties = {
        width: '100%',
        borderCollapse: 'collapse',
        marginBottom: 0,
    };

    const formatDate = (d: string | null | undefined) => {
        if (!d) return '';
        try { return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' }); }
        catch { return d; }
    };

    return (
        <div style={docStyle}>

            {/* ── Company header ── */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8, paddingBottom: 6, borderBottom: '2px solid #000' }}>
                <div style={{ flexShrink: 0 }}>
                    {companyProfile?.logo_url ? (
                        <img src={`${API_BASE}${companyProfile.logo_url}`} alt="Logo"
                            style={{ maxHeight: 68, maxWidth: 92, objectFit: 'contain', display: 'block' }} />
                    ) : (
                        <div style={{ width: 76, height: 56, border: '2px solid #003080', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 17, color: '#003080' }}>BIE</div>
                    )}
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold', fontSize: 16 }}>{companyProfile?.name || 'PT. BOLA INTAN ELASTIC'}</div>
                    {companyProfile?.address && <div>{companyProfile.address}</div>}
                    <div>
                        {companyProfile?.phone && <span>Telp : {companyProfile.phone}</span>}
                        {companyProfile?.phone && companyProfile?.fax && <span> &nbsp; Fax: {companyProfile.fax}</span>}
                    </div>
                    {companyProfile?.email && <div style={{ color: '#0000cc' }}>Email : {companyProfile.email}</div>}
                </div>
            </div>

            {/* ── SPK Sample title ── */}
            <div style={{ border: '1px solid #555', textAlign: 'center', fontWeight: 'bold', fontSize: 15, padding: '4px 0', marginBottom: 0 }}>
                SPK Sample
            </div>

            {/* ── Main fields table ── */}
            <table style={tableStyle}>
                <tbody>
                    <FieldRow label="TGL TURUN SPK" value={formatDate(sample.request_date || sample.created_at)} />
                    <FieldRow label="PROJECT" value={sample.project} />
                    <FieldRow label="NAMA CUSTOMER" value={customerName} />
                    <FieldRow label="KODE ARTIKEL CUSTOMER" value={sample.customer_article_code} />
                    <FieldRow label="KODE ARTIKEL BOLA INTAN" value={sample.internal_article_code || sample.code} />
                    <FieldRow label="LEBAR" value={sample.width} />

                    {/* Color rows */}
                    {colorRows.map((c: any, i: number) => (
                        <tr key={i}>
                            <td style={{ border: '1px solid #555', padding: '4px 7px', fontWeight: 'bold', verticalAlign: 'middle' }}>
                                {i === 0 ? 'WARNA' : ''}
                            </td>
                            <td style={{ border: '1px solid #555', padding: '4px 7px', verticalAlign: 'middle' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 18 }}>
                                    <span>{c?.name || ''}</span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                                        <Checkbox checked={!!c?.is_repeat} />
                                        <span>Repeat</span>
                                        &nbsp;/&nbsp;
                                        <Checkbox checked={c ? !c.is_repeat : false} />
                                        <span>New</span>
                                        &nbsp;
                                        <span style={{ display: 'inline-block', width: 13, height: 13, border: '1px solid #888', verticalAlign: 'middle' }} />
                                    </span>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* ── Detail Quality section ── */}
            <table style={tableStyle}>
                <tbody>
                    <tr>
                        <td colSpan={2} style={{ border: '1px solid #555', padding: '4px 7px', textAlign: 'center', fontWeight: 'bold', fontSize: 14, background: '#bdd7ee', color: '#1f3864', letterSpacing: 1 }}>
                            DETAIL QUALITY
                        </td>
                    </tr>
                    <FieldRow label="LAPIS ATAS" value={sample.main_material} />
                    <FieldRow label="LAPIS TENGAH" value={sample.middle_material} />
                    <FieldRow label="LAPIS BAWAH" value={sample.bottom_material} />
                    <FieldRow label="WEFT" value={sample.weft} />
                    <FieldRow label="KARET" value={sample.warp} />
                    <FieldRow label="BERAT ORIGINAL SAMPEL" value={sample.original_weight != null ? `${sample.original_weight} Gr/Yard` : ''} />
                    <FieldRow label="BERAT BIE SAMPEL" value={sample.production_weight != null ? `${sample.production_weight} Gr/Yard` : ''} />
                    <FieldRow label="INFORMASI TAMBAHAN" value={sample.additional_info} tall />
                </tbody>
            </table>

            {/* ── Logistics ── */}
            <table style={tableStyle}>
                <tbody>
                    <FieldRow label="JUMLAH/ BANYAK SAMPEL" value={sample.quantity} />
                    <FieldRow label="Est Tgl Selesai Sample (Req cust)" value={formatDate(sample.estimated_completion_date)} />
                    <FieldRow label="Est tgl Selesai Sample (div sample)" value={undefined} />
                </tbody>
            </table>

            {/* ── Contoh Original Sample box ── */}
            {showSampleBox && (
                <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 13, marginBottom: 2 }}>Contoh Original Sample</div>
                    <div style={{ border: '1px solid #555', minHeight: 150, padding: '6px 8px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        {sample.completion_description && (
                            <div style={{ fontSize: 13, color: '#000', whiteSpace: 'pre-wrap', marginBottom: 6, alignSelf: 'flex-start' }}>
                                {sample.completion_description}
                            </div>
                        )}
                        {sample.completion_image_url && (
                            <img
                                src={`${API_BASE}${sample.completion_image_url}`}
                                alt="Contoh"
                                style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain', display: 'block' }}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* ── Prioritas + Checklist ── */}
            {showChecklist && colors.length > 0 && (
                <div style={{ marginTop: 8, border: '1px solid #555', padding: '6px 10px' }}>
                    <div style={{ textAlign: 'center', fontWeight: 'bold', color: '#c00', fontSize: 15, marginBottom: 6, letterSpacing: 1 }}>PRIORITAS</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontWeight: 'bold', fontSize: 13 }}>CHECKLIST:</div>
                        <div style={{ display: 'flex', gap: 24 }}>
                            {/* OK column */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {colors.map((c: any, i: number) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ display: 'inline-block', width: 12, height: 12, border: '1px solid #555', flexShrink: 0 }} />
                                        <span style={{ fontSize: 13 }}>OK</span>
                                    </div>
                                ))}
                                {/* extra blank row */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ display: 'inline-block', width: 12, height: 12, border: '1px solid #555', flexShrink: 0 }} />
                                </div>
                            </div>
                            {/* NOT OK column */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {colors.map((c: any, i: number) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ display: 'inline-block', width: 12, height: 12, border: '1px solid #555', flexShrink: 0 }} />
                                        <span style={{ fontSize: 13 }}>NOT OK</span>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ display: 'inline-block', width: 12, height: 12, border: '1px solid #555', flexShrink: 0 }} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Footer ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
                <div>
                    <div style={{ fontSize: 13 }}>Disiapkan oleh :</div>
                    <div style={{ height: 36, borderBottom: '1px solid #000', width: 110, marginTop: 4 }}></div>
                    {preparedBy && <div style={{ fontWeight: 'bold', fontSize: 13, marginTop: 2 }}>{preparedBy}</div>}
                    {preparedRole && <div style={{ fontSize: 13 }}>{preparedRole}</div>}
                </div>
                <div style={{ border: '2px solid #c00', padding: '8px 20px', color: '#c00', fontWeight: 'bold', fontSize: 16, letterSpacing: 1, alignSelf: 'center' }}>
                    INTERNAL REPORT
                </div>
            </div>

        </div>
    );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function SamplePrintModal({
    sample,
    onClose,
    currentStyle,
    companyProfile,
    getCustomerName,
}: {
    sample: any;
    onClose: () => void;
    currentStyle: string;
    companyProfile: any;
    getCustomerName: (id: string) => string;
}) {
    const isClassic = currentStyle === 'classic';

    const [settings, setSettings] = useState<SamplePrintSettings>(() => {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
        } catch { return DEFAULT_SETTINGS; }
    });

    const update = (patch: Partial<SamplePrintSettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
    };

    // CSS isolation for print
    useEffect(() => {
        document.body.classList.add('smp-print-preview-active');
        return () => { document.body.classList.remove('smp-print-preview-active'); };
    }, []);

    // Shared style tokens
    const modalBorder: React.CSSProperties = isClassic
        ? { border: '2px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf' }
        : {};
    const headerStyle: React.CSSProperties = isClassic
        ? { background: 'linear-gradient(to right, #0058e6, #08a5ff)', color: '#fff', fontFamily: 'Tahoma', fontWeight: 'bold', fontSize: 12, padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
        : {};
    const headerClass = isClassic ? '' : 'bg-primary text-white px-3 py-2 d-flex justify-content-between align-items-center';

    const xpBtnGrey: React.CSSProperties = isClassic
        ? { fontFamily: 'Tahoma', fontSize: 11, padding: '3px 12px', background: 'linear-gradient(to bottom,#fff,#d4d0c8)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer', color: '#000' }
        : {};
    const xpBtnGreen: React.CSSProperties = isClassic
        ? { fontFamily: 'Tahoma', fontSize: 11, padding: '3px 14px', background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', border: '1px solid', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }
        : {};

    const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', color: '#111', letterSpacing: '0.5px', marginBottom: 6 };
    const toggleLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#111', cursor: 'pointer' };
    const fieldLabel: React.CSSProperties = { fontSize: 10, color: '#111', marginBottom: 3, fontWeight: 500 };
    const fieldInput: React.CSSProperties = { width: '100%', fontSize: 11, padding: '3px 6px', border: '1px solid #ced4da', boxSizing: 'border-box' as const, color: '#000' };

    const docContent = (
        <SPKDocument
            sample={sample}
            companyProfile={companyProfile}
            getCustomerName={getCustomerName}
            settings={settings}
        />
    );

    const handlePrint = () => {
        const pageStyle = document.createElement('style');
        pageStyle.id = '__smp-page';
        pageStyle.textContent = [
            '@page { size: A4 portrait; margin: 10mm; }',
            'html, body { width: 210mm !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }',
        ].join(' ');
        document.head.appendChild(pageStyle);
        const handler = () => {
            onClose();
            document.getElementById('__smp-page')?.remove();
        };
        window.addEventListener('afterprint', handler, { once: true });
        window.print();
    };

    return (
        <>
            {/* ── Backdrop + modal ── */}
            <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={onClose}
            >
                <div
                    style={{ background: '#fff', width: '90vw', maxWidth: 960, height: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', ...modalBorder }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div style={headerStyle} className={headerClass}>
                        <span>🖨 Print SPK Sample — {sample.code}</span>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 14, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                    </div>

                    {/* Body */}
                    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                        {/* LEFT — settings */}
                        <div style={{ width: 210, minWidth: 210, borderRight: '1px solid #dee2e6', background: '#f8f9fa', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

                            <div>
                                <div style={sectionLabel}>Sections</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <label style={toggleLabel}>
                                        <input type="checkbox" checked={settings.showSampleBox} onChange={e => update({ showSampleBox: e.target.checked })} />
                                        Sample Attachment Box
                                    </label>
                                    <label style={toggleLabel}>
                                        <input type="checkbox" checked={settings.showChecklist} onChange={e => update({ showChecklist: e.target.checked })} />
                                        Prioritas / Checklist
                                    </label>
                                </div>
                            </div>

                            <hr style={{ margin: 0, borderColor: '#dee2e6' }} />

                            <div>
                                <div style={sectionLabel}>Prepared By</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div>
                                        <div style={fieldLabel}>Name</div>
                                        <input style={fieldInput} value={settings.preparedBy} onChange={e => update({ preparedBy: e.target.value })} placeholder="e.g. Lolita" />
                                    </div>
                                    <div>
                                        <div style={fieldLabel}>Title / Role</div>
                                        <input style={fieldInput} value={settings.preparedRole} onChange={e => update({ preparedRole: e.target.value })} placeholder="e.g. Marketing" />
                                    </div>
                                </div>
                            </div>

                            <div style={{ fontSize: 10, color: '#555', marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #dee2e6' }}>
                                Paper size &amp; margins set in browser print dialog.
                            </div>
                        </div>

                        {/* RIGHT — preview */}
                        <div style={{ flex: 1, background: '#e0e0e0', overflowY: 'auto', padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                            <div className="smp-print-paper" style={{ background: '#fff', width: '100%', maxWidth: 480, padding: '20px 24px', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', fontSize: '13px', lineHeight: 1.5, color: '#000', fontFamily: 'Arial, sans-serif' }}>
                                {docContent}
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #dee2e6', background: '#f8f9fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: '#555' }}>Settings saved automatically</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                            {isClassic ? (
                                <>
                                    <button style={xpBtnGrey} onClick={onClose}>Close</button>
                                    <button style={xpBtnGreen} onClick={handlePrint}>🖨 Print</button>
                                </>
                            ) : (
                                <>
                                    <button className="btn btn-sm btn-secondary" onClick={onClose}>Close</button>
                                    <button className="btn btn-sm btn-success" onClick={handlePrint}>🖨 Print</button>
                                </>
                            )}
                        </div>
                    </div>

                </div>
            </div>

            {/* ── Print portal ── */}
            {createPortal(
                <div className="smp-print-paper-portal" style={{ position: 'fixed', left: '-9999px', top: 0 }}>
                    <div className="smp-print-paper" style={{ background: '#fff', width: '100%', padding: '20px 24px', fontSize: '13px', lineHeight: 1.5, color: '#000', fontFamily: 'Arial, sans-serif' }}>
                        {docContent}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
