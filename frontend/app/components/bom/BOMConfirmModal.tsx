import React, { memo } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { CodeChip, xpFont, CHIP_RADIUS, xpBtn as xpBtnBase } from '../shared/xpTheme';
import { BTN_TONES } from '@bryanadamg/terras-ui/styles';

/**
 * Save-time confirmation for the BOM Designer.
 *
 * The designer can persist a whole recursive tree in one click — several BOMs plus
 * any inline-created WIP items — and until now that happened with no preview. This
 * modal renders the exact plan: every node, what will happen to it (create / update /
 * skip), and every item that will be created as a side effect.
 *
 * Deliberately a dumb renderer: the designer owns all the code→name/uom lookups and
 * hands over a finished plan, so this file has no knowledge of designer internals.
 */

export type BOMPlanAction = 'create' | 'update' | 'skip';

export interface BOMPlanLine {
    itemCode: string;
    itemName: string;
    percentage: number;
    qty: number;
    /** Item does not exist yet — saving creates it. */
    isNewItem: boolean;
    /** This line drills into a sub-BOM node further down the plan. */
    hasSubBOM: boolean;
    stepLabel: string | null;
}

export interface BOMPlanNode {
    key: string;
    depth: number;
    bomCode: string;
    itemCode: string;
    itemName: string;
    action: BOMPlanAction;
    /** Why a node is skipped — shown inline so "nothing happened" is never a mystery. */
    skipReason?: string;
    itemWillBeCreated: boolean;
    qty: number;
    uom: string;
    qtyLabel: string;
    attributeSummary: string;
    wastagePct: number;
    overdeliveryPct: number;
    sizeSummary: string;
    operations: { sequence: number; label: string; minutes: number }[];
    lines: BOMPlanLine[];
    children: BOMPlanNode[];
}

export interface BOMPlan {
    root: BOMPlanNode;
    createCount: number;
    updateCount: number;
    skipCount: number;
    /** Unique item codes that will be created as a side effect of saving. */
    newItemCodes: string[];
}

interface BOMConfirmModalProps {
    isOpen: boolean;
    plan: BOMPlan | null;
    saving: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

const xpBtn: React.CSSProperties = xpBtnBase({ whiteSpace: 'nowrap', minWidth: 70 });

const xpBtnPrimary: React.CSSProperties = xpBtnBase({ ...BTN_TONES.primary, minWidth: 130 });

type Family = 'green' | 'blue' | 'gray' | 'amber' | 'red' | 'purple';
const ACTION_STYLE: Record<BOMPlanAction, { family: Family; label: string }> = {
    create: { family: 'green', label: 'CREATE' },
    update: { family: 'blue', label: 'UPDATE' },
    skip: { family: 'gray', label: 'SKIPPED' },
};

// Theme chip tint. Purple (attribute summary) has no chip family, so it keeps its own.
const chipTone = (f: Family): React.CSSProperties => f === 'purple'
    ? { background: '#efe8f8', border: '1px solid #6a4b9a', color: '#3a2a55' }
    : { background: `var(--terras-chip-${f}-bg)`, border: `1px solid var(--terras-chip-${f}-border)`, color: `var(--terras-chip-${f}-text)` };

const Chip = ({ family, children, title }: { family: Family; children: React.ReactNode; title?: string }) => (
    <span
        title={title}
        style={{
            ...chipTone(family), borderRadius: CHIP_RADIUS, fontSize: 9, fontWeight: 'bold',
            padding: '0 4px', fontFamily: xpFont, whiteSpace: 'nowrap',
        }}
    >
        {children}
    </span>
);

const LINE = 'var(--terras-table-line, #d6d3ce)';

const StatTile = ({ value, label, color }: { value: number; label: string; color: string }) => (
    <div style={{
        flex: 1, textAlign: 'center', padding: '3px 6px',
        border: `1px solid ${LINE}`, borderRadius: CHIP_RADIUS, background: 'var(--terras-table-bg, #fff)', minWidth: 64,
    }}>
        <div style={{ fontSize: 15, fontWeight: 'bold', color, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 9, color: 'var(--terras-win-text-3, #555)' }}>{label}</div>
    </div>
);

// One node block. Indentation encodes depth; the left rule keeps deep trees readable.
const PlanNode = memo(({ node }: { node: BOMPlanNode }) => {
    const action = ACTION_STYLE[node.action];
    const dimmed = node.action === 'skip';

    return (
        <div style={{ marginLeft: node.depth === 0 ? 0 : 14, marginTop: 6 }}>
            <div style={{
                border: `1px solid ${LINE}`, borderRadius: CHIP_RADIUS, overflow: 'hidden',
                background: 'var(--terras-table-bg, #fff)',
                opacity: dimmed ? 0.75 : 1,
            }}>
                {/* Node header */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
                    padding: '3px 5px', borderBottom: `1px solid ${LINE}`,
                    background: dimmed ? 'var(--terras-toolbar-bg, #f5f4ef)' : 'var(--terras-chip-blue-bg, #dce4f5)',
                }}>
                    <Chip family={action.family}>{action.label}</Chip>
                    <span style={{ fontWeight: 'bold', fontSize: 11, color: 'var(--terras-chip-blue-text, #0d2a6e)' }}>{node.itemCode}</span>
                    {node.itemName && node.itemName !== node.itemCode && (
                        <span style={{ fontSize: 10, color: 'var(--terras-win-text-3, #555)' }}>{node.itemName}</span>
                    )}
                    {node.itemWillBeCreated && (
                        <Chip family="amber" title="This item does not exist yet and will be created on save">
                            NEW ITEM
                        </Chip>
                    )}
                    {node.attributeSummary && (
                        <Chip family="purple">{node.attributeSummary}</Chip>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--terras-win-text-2, #333)' }}>
                        {node.qtyLabel}
                    </span>
                    <CodeChip code={node.bomCode || '(no code)'} tone="accent" />
                </div>

                {node.skipReason && (
                    <div style={{ padding: '2px 6px', fontSize: 10, color: 'var(--terras-chip-amber-text, #806000)', background: 'var(--terras-chip-amber-bg, #fffbe6)' }}>
                        {node.skipReason}
                    </div>
                )}

                {/* Meta strip */}
                <div style={{
                    display: 'flex', gap: 10, flexWrap: 'wrap',
                    padding: '2px 6px', fontSize: 9, color: 'var(--terras-win-text-3, #555)',
                    borderBottom: node.lines.length || node.operations.length ? '1px solid #e8e5dc' : 'none',
                }}>
                    <span>Wastage {node.wastagePct}%</span>
                    <span>Overdelivery {node.overdeliveryPct}%</span>
                    <span>{node.sizeSummary}</span>
                </div>

                {/* Routing steps */}
                {node.operations.length > 0 && (
                    <div style={{ padding: '3px 6px', borderBottom: node.lines.length ? '1px solid #e8e5dc' : 'none' }}>
                        <div style={{ fontSize: 9, fontWeight: 'bold', color: 'var(--terras-chip-blue-text, #0d2a6e)', marginBottom: 2 }}>
                            Routing ({node.operations.length})
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {node.operations.map(op => (
                                <span key={op.sequence} style={{ borderRadius: CHIP_RADIUS,
                                    fontSize: 9, border: '1px solid var(--terras-chip-blue-border, #c8d4e4)', background: 'var(--terras-chip-blue-bg, #eef4fc)',
                                    padding: '0 4px', color: 'var(--terras-chip-blue-text, #003060)',
                                }}>
                                    {op.sequence} · {op.label}{op.minutes ? ` · ${op.minutes}m` : ''}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Component lines */}
                {node.lines.length > 0 && (
                    <div style={{ padding: '3px 6px' }}>
                        <div style={{ fontSize: 9, fontWeight: 'bold', color: 'var(--terras-chip-blue-text, #0d2a6e)', marginBottom: 2 }}>
                            Components ({node.lines.length})
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                            <tbody>
                                {node.lines.map((line, i) => (
                                    <tr key={i} style={{ borderTop: i ? '1px solid #efeee8' : 'none' }}>
                                        <td style={{ width: 46, textAlign: 'right', paddingRight: 6, fontWeight: 'bold', color: 'var(--terras-win-text-2, #333)' }}>
                                            {line.percentage}%
                                        </td>
                                        <td style={{ color: 'var(--terras-chip-blue-text, #0d2a6e)' }}>
                                            {line.itemCode}
                                            {line.itemName && line.itemName !== line.itemCode && (
                                                <span style={{ color: 'var(--terras-win-text-3, #666)' }}> — {line.itemName}</span>
                                            )}
                                        </td>
                                        <td style={{ width: 150, textAlign: 'right' }}>
                                            <span style={{ display: 'inline-flex', gap: 3, justifyContent: 'flex-end' }}>
                                                {line.stepLabel && (
                                                    <Chip family="blue">{line.stepLabel}</Chip>
                                                )}
                                                {line.hasSubBOM && <Chip family="green">SUB-BOM</Chip>}
                                                {line.isNewItem && <Chip family="amber">NEW ITEM</Chip>}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {node.children.map(child => <PlanNode key={child.key} node={child} />)}
        </div>
    );
});
PlanNode.displayName = 'PlanNode';

const BOMConfirmModal = memo(({ isOpen, plan, saving, onConfirm, onClose }: BOMConfirmModalProps) => {
    if (!isOpen || !plan) return null;

    const totalWrites = plan.createCount + plan.updateCount;

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title={<><i className="bi bi-clipboard-check" style={{ marginRight: 6 }} />Confirm BOM Save</>}
            size="lg"
            variant="primary"
            modeless
            footer={<>
                <button style={xpBtn} onClick={onClose} disabled={saving}>Back</button>
                <button
                    data-testid="confirm-bom-save-btn"
                    style={saving ? { ...xpBtnPrimary, opacity: 0.6, cursor: 'default' } : xpBtnPrimary}
                    onClick={onConfirm}
                    disabled={saving}
                >
                    {saving ? 'Saving...' : `Confirm & Save (${totalWrites})`}
                </button>
            </>}
        >
            <div
                data-testid="bom-confirm-modal"
                style={{ fontFamily: xpFont, fontSize: 11, display: 'flex', flexDirection: 'column', maxHeight: 'calc(var(--app-vh) * 70 / 100)' }}
            >
                {/* Summary tiles */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    <StatTile value={plan.createCount} label="BOMs created" color="var(--terras-status-green, #2a7a2a)" />
                    <StatTile value={plan.updateCount} label="BOMs updated" color="var(--terras-status-blue, #316ac5)" />
                    <StatTile value={plan.newItemCodes.length} label="Items created" color="var(--terras-status-amber, #b46a00)" />
                    {plan.skipCount > 0 && <StatTile value={plan.skipCount} label="Skipped" color="var(--terras-win-text-3, #777)" />}
                </div>

                {plan.newItemCodes.length > 0 && (
                    <div style={{
                        border: '1px solid var(--terras-chip-amber-border, #d4b000)', background: 'var(--terras-chip-amber-bg, #fffbe6)', borderRadius: CHIP_RADIUS,
                        padding: '4px 6px', marginBottom: 6, fontSize: 10, color: 'var(--terras-chip-amber-text, #5a4300)',
                    }}>
                        <strong>New items will be created</strong> (category WIP, uom inherited from the root item):{' '}
                        {plan.newItemCodes.join(', ')}
                    </div>
                )}

                {plan.skipCount > 0 && (
                    <div style={{
                        border: `1px solid ${LINE}`, background: 'var(--terras-toolbar-bg, #f5f4ef)', borderRadius: CHIP_RADIUS,
                        padding: '4px 6px', marginBottom: 6, fontSize: 10, color: 'var(--terras-win-text-2, #555)',
                    }}>
                        Nodes marked <strong>SKIPPED</strong> have no components and no routing steps, so no BOM is
                        written for them. Any new item they name is still created.
                    </div>
                )}

                {/* Tree */}
                <div style={{
                    border: `1px solid ${LINE}`, background: 'var(--terras-table-bg, #fff)',
                    padding: 6, overflowY: 'auto', flex: 1, minHeight: 160,
                }}>
                    <PlanNode node={plan.root} />
                </div>
            </div>
        </ModalWrapper>
    );
});

BOMConfirmModal.displayName = 'BOMConfirmModal';

export default BOMConfirmModal;
