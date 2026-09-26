'use client';
import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { useTimezone } from '../../context/TimezoneContext';
import { useToast } from '../shared/Toast';
import PrintModalShell, { PrintModalFooter } from '../shared/PrintModalShell';
import { xpFont as font, xpInput as xpInputBase } from '../shared/xpTheme';
import { API_BASE, STATIC_BASE } from '../shared/apiBase';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import TemplatePrintPortal from '../shared/printTemplate/TemplatePrintPortal';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import { paperDimsMm } from '../shared/printTemplate/paper';
import { buildSuratJalanContext, SURAT_JALAN_DOC } from '../shared/printTemplate/doctypes/suratJalan';

// The note itself is a print template (defaults/suratJalan.ts, editable in Print
// Layouts). This modal is the loading-deck form around it: it saves the shipment's
// transport facts and feeds the in-progress edits into the render context.

export default function SuratJalanPrintModal({ shipment, attributes, companyProfile, customerAddr, onClose, onSaved }: any) {
    const { authFetch, itemIndex, printTemplates } = useData() as any;
    const { formatCustom } = useTimezone();
    const { showToast } = useToast();
    const [preparedBy, setPreparedBy] = useState('');
    const [sjNo, setSjNo] = useState(shipment.delivery_note_number || shipment.code || '');
    // Staging no longer asks for these up front — they start blank (or whatever
    // was already saved, if this shipment is being reopened) and are saved to the
    // shipment record as the user leaves each field.
    const [vehicle, setVehicle] = useState(shipment.vehicle_plate || '');
    const [driver, setDriver] = useState(shipment.driver || '');
    const [carrier, setCarrier] = useState(shipment.carrier || '');
    const [notes, setNotes] = useState(shipment.notes || '');
    const [deliveryDate, setDeliveryDate] = useState(
        shipment.delivery_date ? String(shipment.delivery_date).slice(0, 10) : '',
    );

    const layout = resolveLayout(SURAT_JALAN_DOC, printTemplates)!;
    const ctx = useMemo(() => buildSuratJalanContext({
        shipment, itemIndex, attributes, customerAddr,
        companyName: companyProfile?.name,
        companyLogoUrl: companyProfile?.logo_url ? `${STATIC_BASE}${companyProfile.logo_url}` : undefined,
        tzFormatCustom: formatCustom,
        overrides: {
            sjNo, vehicle, driver, carrier, notes, preparedBy,
            dateIso: deliveryDate ? new Date(deliveryDate).toISOString() : undefined,
        },
    }), [shipment, itemIndex, attributes, customerAddr, companyProfile, formatCustom,
        sjNo, vehicle, driver, carrier, notes, preparedBy, deliveryDate]);
    const { widthMm: paperW, heightMm: paperH } = paperDimsMm(layout.paper);

    // Persists the whole header in one PUT rather than per-field patches — the
    // fields are all edited on the same short form, so there is nothing to gain
    // from tracking which one changed.
    const persistDetails = async () => {
        const res = await authFetch(`${API_BASE}/shipments/${shipment.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // sjNo is NOT sent. The Surat Jalan number is minted once from the
                // SURAT_JALAN series when the shipment is staged; typing over it
                // here changes the paper coming off this printer and nothing else.
                // The server rejects it either way — the field is not on
                // ShipmentUpdate — so sending it would only look like it saved.
                delivery_date: deliveryDate ? new Date(deliveryDate).toISOString() : null,
                carrier: carrier || null,
                vehicle_plate: vehicle || null,
                driver: driver || null,
                notes: notes || null,
            }),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showToast(`Error: ${e.detail || 'could not save shipment details'}`, 'danger');
            return;
        }
        onSaved?.();
    };

    const handlePrint = async () => {
        // Flush whatever the user was still typing (blur may not have fired yet
        // for the field that had focus) before the note goes out.
        await persistDetails();
        const h = () => onClose();
        window.addEventListener('afterprint', h, { once: true });
        window.print();
    };

    const xpInput: React.CSSProperties = xpInputBase({ fontFamily: font, boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)', width: '100%', boxSizing: 'border-box' });
    const fieldLabel: React.CSSProperties = { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', color: '#111', margin: '14px 0 6px' };

    return (
        <>
            <PrintModalShell
                title={`Surat Jalan — ${(sjNo || '').trim() || shipment.delivery_note_number || shipment.code}`}
                onClose={onClose}
                width="calc(var(--app-vw) * 92 / 100)"
                maxWidth={1100}
                height="calc(var(--app-vh) * 90 / 100)"
                modeless
                layoutDocType={SURAT_JALAN_DOC}
                layoutSample={{ sample: shipment.id }}
            >
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                    <div style={{ width: 220, borderRight: '1px solid #b0a898', background: '#f4f3ee', padding: 14, overflowY: 'auto' }}>
                        <div style={{ ...fieldLabel, marginTop: 0 }}>Surat Jalan No</div>
                        <input style={xpInput} value={sjNo} onChange={e => setSjNo(e.target.value)} placeholder="No" />
                        {/* No onBlur: this one prints, it does not save. */}
                        <div style={{ fontSize: 10, color: '#555555', marginTop: 4 }}>
                            {sjNo.trim() && sjNo.trim() !== (shipment.delivery_note_number || '')
                                ? `Prints on this note only — the shipment keeps ${shipment.delivery_note_number || shipment.code}.`
                                : 'Issued from the Surat Jalan series. An edit prints on this note only.'}
                        </div>
                        <div style={fieldLabel}>Delivery Date</div>
                        <input type="date" style={xpInput} value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} onBlur={persistDetails} />
                        <div style={fieldLabel}>Vehicle No</div>
                        <input style={xpInput} value={vehicle} onChange={e => setVehicle(e.target.value)} onBlur={persistDetails} placeholder="B 9751 CCB" />
                        <div style={fieldLabel}>Driver</div>
                        <input style={xpInput} value={driver} onChange={e => setDriver(e.target.value)} onBlur={persistDetails} />
                        <div style={fieldLabel}>Carrier</div>
                        <input style={xpInput} value={carrier} onChange={e => setCarrier(e.target.value)} onBlur={persistDetails} />
                        <div style={fieldLabel}>Notes</div>
                        <input style={xpInput} value={notes} onChange={e => setNotes(e.target.value)} onBlur={persistDetails} />
                        <div style={fieldLabel}>Prepared By</div>
                        <input style={xpInput} value={preparedBy} onChange={e => setPreparedBy(e.target.value)} placeholder="Name" />
                        <div style={{ fontSize: 10, color: '#555', marginTop: 14 }}>Paper size, margins and layout are set in Print Layouts.</div>
                    </div>
                    <div style={{ flex: 1, background: '#808080', overflow: 'auto', padding: 16, display: 'flex', alignItems: 'flex-start' }}>
                        {/* True size, page margin drawn as padding — the portal below prints
                            the same renderer on a page sized from the same layout. */}
                        <div style={{
                            background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0, margin: '0 auto',
                            width: `${paperW}mm`, minHeight: `${paperH}mm`, padding: `${layout.paper.marginMm}mm`,
                            boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                        }}>
                            <TemplateRenderer layout={layout} ctx={ctx} docType={SURAT_JALAN_DOC} />
                        </div>
                    </div>
                </div>
                <PrintModalFooter note="Details are saved as you leave each field." onClose={onClose} onPrint={handlePrint} />
            </PrintModalShell>

            <TemplatePrintPortal layout={layout} ctx={ctx} docType={SURAT_JALAN_DOC} />
        </>
    );
}
