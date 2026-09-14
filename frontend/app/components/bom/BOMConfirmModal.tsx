import React, { memo } from 'react';
import ModalWrapper from '../shared/ModalWrapper';
import { CodeChip, xpFont, CHIP_RADIUS, xpBtn as xpBtnBase, BTN_TONES } from '../shared/xpTheme';

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

const ACTION_STYLE: Record<BOMPlanAction, { bg: string; fg: string; label: string }> = {
    create: { bg: '#2a7a2a', fg: '#fff', label: 'CREATE' },
    update: { bg: '#316ac5', fg: '#fff', label: 'UPDATE' },
    skip: { bg: '#9a9a90', fg: '#fff', label: 'SKIPPED' },
};

const Chip = ({ bg, fg, children, title }: { bg: string; fg: string; children: React.ReactNode; title?: string }) => (
    <span
        title={title}
        style={{
            background: bg, color: fg, fontSize: 9, fontWeight: 'bold',
            padding: '1px 5px', fontFamily: xpFont, whiteSpace: 'nowrap',
        }}
    >
        {children}
    </span>
);

const StatTile = ({ value, label, color }: { value: number; label: string; color: string }) => (
    <div style={{
        flex: 1, textAlign: 'center', padding: '3px 6px',
        border: '1px solid #aca899', background: '#fff', minWidth: 64,
    }}>
        <div style={{ fontSize: 15, fontWeight: 'bold', color, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 9, color: '#555' }}>{label}</div>
    </div>
);

// One node block. Indentation encodes depth; the left rule keeps deep trees readable.
const PlanNode = memo(({ node }: { node: BOMPlanNode }) => {
    const action = ACTION_STYLE[node.action];
    const dimmed = node.action === 'skip';

    return (
        <div style={{ marginLeft: node.depth === 0 ? 0 : 14, marginTop: 6 }}>
            <div style={{
                border: '1px solid #aca899',
                background: dimmed ? '#f2f1ec' : '#fbfaf6',
                opacity: dimmed ? 0.75 : 1,
            }}>
                {/* Node header */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
                    padding: '3px 5px', borderBottom: '1px solid #e2dfd6',
                    background: dimmed ? '#eae8e1' : '#f0eee6',
                }}>
                    <Chip bg={action.bg} fg={action.fg}>{action.label}</Chip>
                    <span style={{ fontWeight: 'bold', fontSize: 11, color: '#000080' }}>{node.itemCode}</span>
                    {node.itemName && node.itemName !== node.itemCode && (
                        <span style={{ fontSize: 10, color: '#555' }}>{node.itemName}</span>
                    )}
                    {node.itemWillBeCreated && (
                        <Chip bg="#b46a00" fg="#fff" title="This item does not exist yet and will be created on save">
                            NEW ITEM
                        </Chip>
                    )}
                    {node.attributeSummary && (
                        <Chip bg="#7a2a7a" fg="#fff">{node.attributeSummary}</Chip>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#333' }}>
                        {node.qtyLabel}
                    </span>
                    <CodeChip code={node.bomCode || '(no code)'} tone="accent" />
                </div>

                {node.skipReason && (
                    <div style={{ padding: '2px 6px', fontSize: 10, color: '#806000', background: '#fffbe6' }}>
                        {node.skipReason}
                    </div>
                )}

                {/* Meta strip */}
                <div style={{
                    display: 'flex', gap: 10, flexWrap: 'wrap',
                    padding: '2px 6px', fontSize: 9, color: '#555',
                    borderBottom: node.lines.length || node.operations.length ? '1px solid #e8e5dc' : 'none',
                }}>
                    <span>Wastage {node.wastagePct}%</span>
                    <span>Overdelivery {node.overdeliveryPct}%</span>
                    <span>{node.sizeSummary}</span>
                </div>

                {/* Routing steps */}
                {node.operations.length > 0 && (
                    <div style={{ padding: '3px 6px', borderBottom: node.lines.length ? '1px solid #e8e5dc' : 'none' }}>
                        <div style={{ fontSize: 9, fontWeight: 'bold', color: '#000080', marginBottom: 2 }}>
                            Routing ({node.operations.length})
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {node.operations.map(op => (
                                <span key={op.sequence} style={{ borderRadius: CHIP_RADIUS,
                                    fontSize: 9, border: '1px solid #c8d4e4', background: '#eef4fc',
                                    padding: '0 4px', color: '#003060',
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
                        <div style={{ fontSize: 9, fontWeight: 'bold', color: '#000080', marginBottom: 2 }}>
                            Components ({node.lines.length})
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                            <tbody>
                                {node.lines.map((line, i) => (
                                    <tr key={i} style={{ borderTop: i ? '1px solid #efeee8' : 'none' }}>
                                        <td style={{ width: 46, textAlign: 'right', paddingRight: 6, fontWeight: 'bold', color: '#333' }}>
                                            {line.percentage}%
                                        </td>
                                        <td style={{ color: '#000080' }}>
                                            {line.itemCode}
                                            {line.itemName && line.itemName !== line.itemCode && (
                                                <span style={{ color: '#666' }}> — {line.itemName}</span>
                                            )}
                                        </td>
                                        <td style={{ width: 150, textAlign: 'right' }}>
                                            <span style={{ display: 'inline-flex', gap: 3, justifyContent: 'flex-end' }}>
                                                {line.stepLabel && (
                                                    <Chip bg="#dfe8f4" fg="#003060">{line.stepLabel}</Chip>
                                                )}
                                                {line.hasSubBOM && <Chip bg="#dfeadf" fg="#1a5e1a">SUB-BOM</Chip>}
                                                {line.isNewItem && <Chip bg="#f8ead0" fg="#804000">NEW ITEM</Chip>}
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
                    <StatTile value={plan.createCount} label="BOMs created" color="#2a7a2a" />
                    <StatTile value={plan.updateCount} label="BOMs updated" color="#316ac5" />
                    <StatTile value={plan.newItemCodes.length} label="Items created" color="#b46a00" />
                    {plan.skipCount > 0 && <StatTile value={plan.skipCount} label="Skipped" color="#777" />}
                </div>

                {plan.newItemCodes.length > 0 && (
                    <div style={{
                        border: '1px solid #d4b000', background: '#fffbe6',
                        padding: '4px 6px', marginBottom: 6, fontSize: 10, color: '#5a4300',
                    }}>
                        <strong>New items will be created</strong> (category WIP, uom inherited from the root item):{' '}
                        {plan.newItemCodes.join(', ')}
                    </div>
                )}

                {plan.skipCount > 0 && (
                    <div style={{
                        border: '1px solid #aca899', background: '#f2f1ec',
                        padding: '4px 6px', marginBottom: 6, fontSize: 10, color: '#555',
                    }}>
                        Nodes marked <strong>SKIPPED</strong> have no components and no routing steps, so no BOM is
                        written for them. Any new item they name is still created.
                    </div>
                )}

                {/* Tree */}
                <div style={{
                    border: '2px inset #aaa', background: '#fff',
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
