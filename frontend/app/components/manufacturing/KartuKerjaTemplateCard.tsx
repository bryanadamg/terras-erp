'use client';
import React from 'react';

import { useTimezone } from '../../context/TimezoneContext';
import TemplateRenderer from '../shared/printTemplate/TemplateRenderer';
import { buildPrintContext } from '../shared/printTemplate/renderContext';
import { docTypeForWorkCenter } from '../shared/printTemplate/defaults/kartuKerja';
import { resolveLayout } from '../shared/printTemplate/templateStore';
import type { PrintTemplateRecord } from '../shared/printTemplate/types';
import type { DyeingPrintData } from '../shared/printTemplate/dyeingPrintData';

/**
 * Print-time preferences from the modal's sidebar. Declared here rather than
 * imported: the hardcoded KartuKerjaCard* cards this replaced are deleted.
 */
export interface KartuKerjaSettings {
    showMaterials: boolean;
    showFillFields: boolean;
    showSignature: boolean;
    headerDepartment: string;
}

/**
 * Kartu Kerja card body, rendered from a print template.
 *
 * Drop-in replacement for the KartuKerjaCard dispatcher: same props, plus the
 * saved templates. Work-centre type still selects which layout applies — the
 * dispatcher's switch became `docTypeForWorkCenter` — but the layout itself is now
 * data, so the client edits it in the print designer instead of us editing JSX.
 *
 * The print-time "Step Materials" / "Signature Line" checkboxes still work: they
 * override band visibility for this one print without touching the saved template.
 */
export default function KartuKerjaTemplateCard({
    workOrder,
    parentMO,
    qrDataUrl,
    settings,
    companyName,
    attributes = [],
    templates,
    dyeing = null,
}: {
    workOrder: any;
    parentMO: any;
    qrDataUrl: string;
    settings: KartuKerjaSettings;
    companyName?: string;
    attributes?: any[];
    templates?: PrintTemplateRecord[] | null;
    /** Bath + doses for a dyeing card, fetched by the print surface. */
    dyeing?: DyeingPrintData | null;
}) {
    const { formatCustom } = useTimezone();

    const docType = docTypeForWorkCenter(workOrder?.work_center_type);
    const layout = resolveLayout(docType, templates);

    if (!layout) return null;

    const ctx = buildPrintContext({
        workOrder,
        parentMO,
        qrDataUrl,
        companyName,
        department: settings.headerDepartment,
        attributes,
        tzFormatCustom: formatCustom,
        dyeing,
    });

    return (
        <TemplateRenderer
            layout={layout}
            ctx={ctx}
            docType={docType}
            bandOverrides={{
                materials: settings.showMaterials,
                signature: settings.showSignature,
            }}
        />
    );
}
