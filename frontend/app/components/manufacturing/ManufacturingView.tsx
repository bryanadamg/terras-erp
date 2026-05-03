import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { Html5QrcodeScanner } from 'html5-qrcode';
import CodeConfigModal, { CodeConfig, buildCodeParts } from '../shared/CodeConfigModal';
import CalendarView from '../shared/CalendarView';
import SearchableSelect from '../shared/SearchableSelect';
import QRScannerView from '../shared/QRScannerView';
import { useToast } from '../shared/Toast';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useData } from '../../context/DataContext';
import ModalWrapper from '../shared/ModalWrapper';
import PrintHeader from '../shared/PrintHeader';
import WOPrintModal, { PrintSettings } from './WOPrintModal';
import ProductionRunModal from './ProductionRunModal';
import WorkOrderPanel from './WorkOrderPanel';
import MOCompletionModal from './MOCompletionModal';
import MOCreationPreview from './MOCreationPreview';

export default function ManufacturingView({
    items,
    boms,
    locations,
    attributes,
    manufacturingOrders,
    productionRuns,
    stockBalance,
    workCenters,
    operations,
    onCreateMO,
    onUpdateStatus,
    onDeleteMO,
    onCreateProductionRun,
    onDeleteProductionRun,
    onUpdatePRStatus,
    onCreateWO,
    onUpdateWO,
    onUpdateWOStatus,
    onDeleteWO,
    currentPage,
    totalItems,
    pageSize,
    onPageChange,
    prPage,
    prTotal,
    setPrPage,
    initialCreateState,
    onClearInitialState,
    initialPRState,
    onClearInitialPRState,
    initialTab,
    showTabSwitcher = true
}: any) {
  const { showToast } = useToast();
  const router = useRouter();
  const { t } = useLanguage();
  const { authFetch, companyProfile, fetchData } = useData();
  const envBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api';
  const API_BASE = envBase.endsWith('/api') ? envBase : `${envBase}/api`;
  const [viewMode, setViewMode] = useState('list');

  // Keep a ref so scanner callbacks always access the latest manufacturingOrders without stale closure issues
  const workOrdersRef = useRef<any[]>(manufacturingOrders);
  useEffect(() => { workOrdersRef.current = manufacturingOrders; }, [manufacturingOrders]);

  // Tab state: 'production-runs' | 'manufacturing-orders'
  const [activeTab, setActiveTab] = useState<'production-runs' | 'manufacturing-orders'>(initialTab || 'production-runs');
  const [isPRModalOpen, setIsPRModalOpen] = useState(false);
  const [prModalBom, setPrModalBom] = useState<any>(null);
  const [prModalInitialSizes, setPrModalInitialSizes] = useState<Record<string, string> | undefined>(undefined);
  const [prModalTotalQty, setPrModalTotalQty] = useState<string | undefined>(undefined);
  const [prModalSalesOrderId, setPrModalSalesOrderId] = useState<string | undefined>(undefined);

  // Derived Pagination
  const totalPages = Math.ceil(totalItems / pageSize);
  const startRange = (currentPage - 1) * pageSize + 1;
  const endRange = Math.min(currentPage * pageSize, totalItems);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWO, setNewWO] = useState({
      code: '',
      bom_id: '',
      location_code: '',
      source_location_code: '',
      qty: 1.0,
      target_start_date: '',
      target_end_date: '',
      sales_order_id: '',
      bom_size_id: '',
      create_nested: true,
  });
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [printPreviewWO, setPrintPreviewWO] = useState<any>(null);
  const [printHideChildren, setPrintHideChildren] = useState(false);
  
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [expandedPRs, setExpandedPRs] = useState<Record<string, boolean>>({});
  const [prMaterialReqs, setPrMaterialReqs] = useState<Record<string, any[]>>({});
  const [prMaterialReqsLoading, setPrMaterialReqsLoading] = useState<Record<string, boolean>>({});
  const [selectedTreeNodes, setSelectedTreeNodes] = useState<Record<string, string>>({});
  const [qrDataUrls, setQrDataUrls] = useState<Record<string, string>>({});
  const [scanningWOId, setScanningWOId] = useState<string | null>(null);
  const [completionMO, setCompletionMO] = useState<any>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [codeConfig, setCodeConfig] = useState<CodeConfig>({
      prefix: 'MO',
      suffix: '',
      separator: '-',
      includeItemCode: true,
      includeVariant: false,
      variantAttributeNames: [],
      includeYear: false,
      includeMonth: false
  });

  const { uiStyle: currentStyle } = useTheme();

  const defaultPrintSettings: PrintSettings = {
    showBOMTable: true,
    showTimeline: true,
    showChildMOs: false,
    showSignatureLine: true,
    showTechnicalFields: true,
    showFillFields: true,
    showSamplePhoto: true,
    headerCompanyName: '',
    headerDepartment: '',
    headerApprovedBy: '',
    headerReference: '',
  };

  const [printSettings, setPrintSettings] = useState<PrintSettings>(defaultPrintSettings);

  // Handle Automated Creation from Sales Order
  useEffect(() => {
      if (initialCreateState && items.length > 0 && boms.length > 0) {
          const { bom_id, qty, sales_order_id, bom_size_id } = initialCreateState;

          // Use the bom_id passed from the SO page (already matched on item + attributes)
          const bom = boms.find((b: any) => b.id === bom_id);

          if (bom) {
              const base = buildWOBasePattern(bom.id);
              fetchAvailableCode(base).then(suggestedCode => {
                  setNewWO(prev => ({
                      ...prev,
                      code: suggestedCode,
                      bom_id: bom.id,
                      qty: qty,
                      sales_order_id: sales_order_id || '',
                      bom_size_id: bom_size_id || '',
                  }));
                  setIsCreateOpen(true);
                  onClearInitialState();
                  showToast('Production details pre-filled from Sales Order', 'info');
              });
          } else {
              showToast('No active BOM found for the requested item.', 'warning');
              onClearInitialState();
          }
      }
  }, [initialCreateState, items, boms, onClearInitialState]);

  // Handle PR creation pre-fill from Sales Order
  useEffect(() => {
      if (initialPRState && boms.length > 0) {
          const { bom_id, sizes, sales_order_id, total_qty } = initialPRState;
          const bom = boms.find((b: any) => b.id === bom_id);
          if (bom) {
              const sizeMap: Record<string, string> = {};
              (sizes || []).forEach((s: any) => { sizeMap[s.bom_size_id] = String(s.qty); });
              setActiveTab('production-runs');
              setPrModalBom(bom);
              setPrModalInitialSizes(Object.keys(sizeMap).length > 0 ? sizeMap : undefined);
              setPrModalTotalQty(total_qty ? String(total_qty) : undefined);
              setPrModalSalesOrderId(sales_order_id || undefined);
              setIsPRModalOpen(true);
              onClearInitialPRState?.();
              showToast('Production Run pre-filled from Sales Order', 'info');
          } else {
              showToast('No matching BOM found for Production Run.', 'warning');
              onClearInitialPRState?.();
          }
      }
  }, [initialPRState, boms]);

  useEffect(() => {
      const savedConfig = localStorage.getItem('mo_code_config');
      if (savedConfig) {
          try { setCodeConfig(JSON.parse(savedConfig)); } catch (e) {}
      }
      const savedPrintSettings = localStorage.getItem('mo_print_settings');
      if (savedPrintSettings) {
          try { setPrintSettings(JSON.parse(savedPrintSettings)); } catch (e) {}
      }
  }, []);

  useEffect(() => {
      localStorage.setItem('mo_print_settings', JSON.stringify(printSettings));
  }, [printSettings]);

  useEffect(() => {
      const expandedIds = Object.keys(expandedRows).filter(id => expandedRows[id]);
      for (const woId of expandedIds) {
          const wo = manufacturingOrders.find((w: any) => w.id === woId);
          if (!wo) continue;
          const moMap: Record<string, any> = {};
          if (wo.production_run_id) {
              const pr = productionRuns.find((p: any) => p.id === wo.production_run_id);
              if (pr) {
                  for (const mo of (pr.manufacturing_orders || [])) {
                      moMap[mo.id] = mo;
                  }
              }
          }
          const nodes = flattenTree(wo, 0, moMap);
          for (const { wo: node } of nodes) {
              if (!qrDataUrls[node.code]) {
                  QRCode.toDataURL(node.code, { margin: 1, width: 160 })
                      .then(url => setQrDataUrls(prev => ({ ...prev, [node.code]: url })))
                      .catch(() => {});
              }
          }
      }
  }, [expandedRows, manufacturingOrders, productionRuns]);

  const buildWOBasePattern = (bomId: string, config = codeConfig) => {
      const bom = boms.find((b: any) => b.id === bomId);
      if (!bom) return '';
      const item = items.find((i: any) => i.id === bom.item_id);
      const itemCode = item ? item.code : 'PROD';

      const names: string[] = [];
      if (config.includeVariant && bom.attribute_value_ids) {
          for (const attrName of (config.variantAttributeNames ?? [])) {
              const attr = attributes.find((a: any) => a.name === attrName);
              if (!attr) continue;
              const selectedVal = attr.values.find((v: any) => bom.attribute_value_ids.includes(v.id));
              if (selectedVal) names.push(selectedVal.value.toUpperCase().replace(/\s+/g, ''));
          }
      }

      return buildCodeParts(config, itemCode, names).join(config.separator);
  };

  const fetchAvailableCode = async (base: string): Promise<string> => {
      try {
          const res = await authFetch(`${API_BASE}/manufacturing-orders/available-code?base=${encodeURIComponent(base)}`);
          if (res.ok) {
              const data = await res.json();
              return data.code;
          }
      } catch (_) {}
      return `${base}-00001`;
  };

  const handleSaveConfig = async (newConfig: CodeConfig) => {
      setCodeConfig(newConfig);
      localStorage.setItem('mo_code_config', JSON.stringify(newConfig));
      let base: string;
      if (newWO.bom_id) {
          base = buildWOBasePattern(newWO.bom_id, newConfig);
      } else {
          const parts = [];
          if (newConfig.prefix) parts.push(newConfig.prefix);
          const now = new Date();
          if (newConfig.includeYear) parts.push(now.getFullYear());
          if (newConfig.includeMonth) parts.push(String(now.getMonth() + 1).padStart(2, '0'));
          if (newConfig.suffix) parts.push(newConfig.suffix);
          base = parts.join(newConfig.separator);
      }
      if (base) {
          const suggested = await fetchAvailableCode(base);
          setNewWO(prev => ({ ...prev, code: suggested }));
      }
  };

  const handlePrintList = () => {
      window.print();
  };

  const handlePrintWO = (wo: any, hideChildren = false) => {
      setPrintHideChildren(hideChildren);
      setPrintPreviewWO(wo);
  };

  const filteredWorkOrders = manufacturingOrders.filter((wo: any) => {
      const date = new Date(wo.created_at);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      if (start && date < start) return false;
      if (end) {
          const endDateTime = new Date(end);
          endDateTime.setHours(23, 59, 59, 999);
          if (date > endDateTime) return false;
      }
      return true;
  });

  const handleBOMChange = async (bomId: string) => {
      const base = buildWOBasePattern(bomId);
      const suggestedCode = base ? await fetchAvailableCode(base) : '';
      setNewWO({...newWO, bom_id: bomId, code: suggestedCode});
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (isSubmitting) return;
      setIsSubmitting(true);
      try {
          // Clean dates: convert empty strings to null for Pydantic
          const payload = {
              ...newWO,
              target_start_date: newWO.target_start_date || null,
              target_end_date: newWO.target_end_date || null,
              sales_order_id: newWO.sales_order_id || null,
              bom_size_id: newWO.bom_size_id || null,
          };

          const res = await onCreateMO(payload);
          if (res && res.status === 400) {
              const baseMatch = newWO.code.match(/^(.*)-\d+$/);
              const base = baseMatch ? baseMatch[1] : newWO.code;
              const suggestedCode = await fetchAvailableCode(base);
              showToast(`Manufacturing Order Code "${newWO.code}" already exists. Suggesting: ${suggestedCode}`, 'warning');
              setNewWO({ ...newWO, code: suggestedCode });
          } else if (res && res.ok) {
              const createdMO = await res.json();
              if (createdMO.is_material_available === false) {
                  showToast('Manufacturing Order created, but insufficient materials!', 'warning');
              } else {
                  showToast('Manufacturing Order created successfully!', 'success');
              }
              setNewWO({ code: '', bom_id: '', location_code: '', source_location_code: '', qty: 1.0, target_start_date: '', target_end_date: '', sales_order_id: '', bom_size_id: '', create_nested: true });
              setIsCreateOpen(false);
          } else {
              showToast('Failed to create Manufacturing Order', 'danger');
          }
      } finally {
          setIsSubmitting(false);
      }
  };

  const toggleRow = (id: string) => {
      setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Helpers
  const getItemName = (id: string) => items.find((i: any) => i.id === id)?.name || id;
  const getItemCode = (id: string) => items.find((i: any) => i.id === id)?.code || id;
  const getBOMCode = (id: string) => boms.find((b: any) => b.id === id)?.code || id;
  const getLocationName = (id: string) => locations.find((l: any) => l.id === id)?.name || id;
  const getOpName = (id: string) => operations.find((o: any) => o.id === id)?.name || id;
  const getWCName = (id: string) => workCenters.find((w: any) => w.id === id)?.name || id;

  const findNodeById = (node: any, id: string): any => {
      if (node.id === id) return node;
      for (const child of (node.child_mos || [])) {
          const found = findNodeById(child, id);
          if (found) return found;
      }
      return null;
  };

  const findNodeByCode = (code: string): any => {
      for (const wo of workOrdersRef.current) {
          const found = findNodeByCodeInTree(wo, code);
          if (found) return found;
      }
      // Also search shared component MOs from production runs
      for (const pr of productionRuns) {
          for (const mo of (pr.manufacturing_orders || [])) {
              if (mo.is_shared_component && mo.code === code) return mo;
          }
      }
      return null;
  };

  const findNodeByCodeInTree = (node: any, code: string): any => {
      if (node.code === code) return node;
      for (const child of (node.child_mos || [])) {
          const found = findNodeByCodeInTree(child, code);
          if (found) return found;
      }
      return null;
  };

  const flattenTree = (node: any, level = 0, moMap: Record<string, any> = {}, isShared = false): Array<{wo: any; level: number; isShared: boolean}> => {
      const result: Array<{wo: any; level: number; isShared: boolean}> = [{wo: node, level, isShared}];
      for (const child of (node.child_mos || [])) {
          result.push(...flattenTree(child, level + 1, moMap, false));
      }
      // Include shared component MOs linked via mo_dependencies
      for (const reqId of (node.required_mo_ids || [])) {
          const reqMO = moMap[reqId];
          if (reqMO) {
              result.push(...flattenTree(reqMO, level + 1, moMap, true));
          }
      }
      return result;
  };
  
  const getAttributeValueName = (valId: string) => {
      for (const attr of attributes) {
          const val = attr.values.find((v: any) => v.id === valId);
          if (val) return val.value;
      }
      return valId;
  };

  const getBomSizeLabel = (bomId: string, bomSizeId: string): string => {
      const bom = boms.find((b: any) => b.id === bomId);
      if (!bom) return '';
      const bs = (bom.sizes || []).find((s: any) => s.id === bomSizeId);
      if (!bs) return '';
      const parts: string[] = [];
      const sizeName = bs.size_name || bs.size?.name;
      if (sizeName) parts.push(sizeName);
      if (bs.label) parts.push(bs.label);
      if (bs.target_measurement != null) {
          let meas = `${parseFloat(bs.target_measurement)}`;
          if (bs.measurement_min != null && bs.measurement_max != null) {
              meas += ` (${parseFloat(bs.measurement_min)}–${parseFloat(bs.measurement_max)})`;
          }
          parts.push(meas + ' cm');
      }
      return parts.join(' — ') || '';
  };

  const getStatusBadge = (status: string) => {
      switch(status) {
          case 'COMPLETED': return 'bg-success';
          case 'IN_PROGRESS': return 'bg-warning text-dark';
          case 'CANCELLED': return 'bg-danger';
          default: return 'bg-secondary';
      }
  };

  const formatDate = (date: string | null) => {
      if (!date) return '-';
      return new Date(date).toLocaleDateString();
  };

  const formatDateTime = (date: string | null) => {
      if (!date) return '-';
      return new Date(date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  };

  const getDueDateWarning = (wo: any) => {
      if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') return null;
      if (!wo.target_end_date) return null;
      const due = new Date(wo.target_end_date);
      const now = new Date();
      const diffDays = (due.getTime() - now.getTime()) / (1000 * 3600 * 24);
      if (diffDays < 0) return { type: 'danger', icon: 'bi-exclamation-octagon-fill', text: 'Overdue!' };
      if (diffDays < 2) return { type: 'warning', icon: 'bi-exclamation-triangle-fill', text: 'Due Soon' };
      return null;
  };

  const calculateRequiredQty = (baseQty: number, line: any, bom: any) => {
      let required: number;
      if (line.percentage > 0) {
          required = (baseQty * line.percentage) / 100;
      } else {
          required = baseQty * parseFloat(line.qty || 0);
      }
      const tolerance = parseFloat(bom?.tolerance_percentage || 0);
      if (tolerance > 0) {
          required = required * (1 + (tolerance / 100));
      }
      return required;
  };

  const checkStockAvailability = (item_id: string, location_id: string, attribute_value_ids: string[] = [], required_qty: number) => {
      const targetKey = [...attribute_value_ids].map(String).sort().join(',');
      const matchingEntries = stockBalance.filter((s: any) => {
          if (String(s.item_id) !== String(item_id)) return false;
          if (String(s.location_id) !== String(location_id)) return false;
          if (attribute_value_ids.length > 0) {
              const sKey = [...(s.attribute_value_ids || [])].map(String).sort().join(',');
              return sKey === targetKey;
          }
          return true;
      });
      const available = matchingEntries.reduce((sum: number, e: any) => sum + parseFloat(e.qty), 0);
      return { available, isEnough: available >= required_qty };
  };

  const fetchPRMaterialRequirements = async (prId: string) => {
      setPrMaterialReqsLoading(prev => ({ ...prev, [prId]: true }));
      try {
          const res = await authFetch(`${API_BASE}/production-runs/${prId}/material-requirements`);
          if (res.ok) {
              const data = await res.json();
              setPrMaterialReqs(prev => ({ ...prev, [prId]: data }));
          }
      } finally {
          setPrMaterialReqsLoading(prev => ({ ...prev, [prId]: false }));
      }
  };

  const togglePR = (prId: string) => {
      setExpandedPRs(prev => {
          const expanding = !prev[prId];
          if (expanding && !prMaterialReqs[prId]) fetchPRMaterialRequirements(prId);
          return { ...prev, [prId]: expanding };
      });
  };

  // --- Inline QR Scanner Widget ---
  const InlineScanWidget = ({ rootWoId, onClose }: { rootWoId: string; onClose: () => void }) => {
      const scannerRef2 = useRef<any>(null);
      const readerId = `reader-${rootWoId}`;

      useEffect(() => {
          const timer = setTimeout(() => {
              if (!document.getElementById(readerId)) return;
              const scanner = new Html5QrcodeScanner(readerId, { fps: 10, qrbox: { width: 180, height: 180 } }, false);
              scannerRef2.current = scanner;
              scanner.render((code: string) => {
                  const found = findNodeByCode(code);
                  if (found) {
                      scanner.clear().catch(() => {});
                      onClose();
                      if (found.status === 'PENDING') {
                          onUpdateStatus(found.id, 'IN_PROGRESS');
                      } else if (found.status === 'IN_PROGRESS') {
                          setCompletionMO(found);
                      } else {
                          showToast(`MO "${code}" is already ${found.status}`, 'warning');
                      }
                  } else {
                      showToast(`MO "${code}" not found`, 'danger');
                  }
              }, () => {});
          }, 100);
          return () => {
              clearTimeout(timer);
              scannerRef2.current?.clear().catch(() => {});
          };
      }, [readerId]);

      return (
          <div style={{ width: '100%' }}>
              <div id={readerId} style={{ width: '100%' }}></div>
              <button className="btn btn-sm btn-outline-secondary w-100 mt-1 extra-small" onClick={onClose}>
                  <i className="bi bi-x me-1"></i>Cancel Scan
              </button>
          </div>
      );
  };

  // --- Work Order Expanded Panel (Tree + Detail) ---
  const WOExpandedPanel = ({ wo }: { wo: any }) => {
      const selectedNodeId = selectedTreeNodes[wo.id] ?? wo.id;

      // Build a map of all MOs in the same PR so required component MOs appear in the tree
      const moMap: Record<string, any> = {};
      if (wo.production_run_id) {
          const pr = productionRuns.find((p: any) => p.id === wo.production_run_id);
          if (pr) {
              for (const mo of (pr.manufacturing_orders || [])) {
                  moMap[mo.id] = mo;
              }
          }
      }

      const treeNodes = flattenTree(wo, 0, moMap);

      // findNodeById must also search moMap for shared component MOs
      const findNodeInTree = (id: string): any => {
          const inTree = findNodeById(wo, id);
          if (inTree) return inTree;
          return moMap[id] ?? null;
      };

      const selectedNode = findNodeInTree(selectedNodeId) ?? wo;
      const bom = boms.find((b: any) => b.id === selectedNode.bom_id);
      const isScanActive = scanningWOId === wo.id;
      const classic = currentStyle === 'classic';

      const selectNode = (nodeId: string) => {
          setSelectedTreeNodes(prev => ({ ...prev, [wo.id]: nodeId }));
          if (scanningWOId === wo.id) setScanningWOId(null);
      };

      return (
          <>
          <div style={{ display: 'flex', minHeight: '280px', background: classic ? '#f5f3ee' : '#f8f9fa', border: classic ? '1px solid #808080' : undefined }}>

              {/* ── LEFT: MO Tree ── */}
              <div style={{
                  width: '210px', minWidth: '210px',
                  borderRight: classic ? '2px solid #808080' : '1px solid #dee2e6',
                  background: '#fff',
                  display: 'flex', flexDirection: 'column'
              }}>
                  <div style={{
                      background: classic ? 'linear-gradient(to right,#0058e6,#08a5ff)' : '#343a40',
                      color: '#fff', fontWeight: 'bold', fontSize: '11px',
                      padding: '5px 8px', letterSpacing: '0.3px'
                  }}>
                      <i className="bi bi-diagram-3-fill me-2"></i>MO Tree
                  </div>
                  <div style={{ padding: '4px', overflowY: 'auto', flex: 1 }}>
                      {treeNodes.map(({ wo: node, level, isShared }: { wo: any; level: number; isShared: boolean }) => {
                          const isActive = node.id === selectedNodeId;
                          const statusColor = node.status === 'COMPLETED' ? '#2d7a2d' : node.status === 'IN_PROGRESS' ? (classic ? '#0058e6' : '#fd7e14') : '#6c757d';
                          return (
                              <div
                                  key={node.id}
                                  onClick={() => selectNode(node.id)}
                                  style={{
                                      display: 'flex', alignItems: 'flex-start', gap: '4px',
                                      padding: `3px 6px 3px ${level * 14 + 6}px`,
                                      cursor: 'pointer', borderRadius: classic ? '0' : '3px',
                                      background: isActive ? (classic ? '#316ac5' : '#0d6efd') : 'transparent',
                                      color: isActive ? '#fff' : '#000',
                                      border: isActive ? (classic ? '1px solid #003080' : 'none') : (isShared ? '1px dashed #999' : '1px solid transparent'),
                                      marginBottom: '1px',
                                      userSelect: 'none'
                                  }}
                              >
                                  <span style={{ fontSize: '10px', color: isActive ? '#cce0ff' : '#888', minWidth: '10px', marginTop: '1px' }}>
                                      {level === 0 ? '●' : (isShared ? '⇒' : '└')}
                                  </span>
                                  <div style={{ flex: 1, overflow: 'hidden' }}>
                                      <div style={{ fontFamily: 'monospace', fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {node.code}
                                      </div>
                                      <div style={{ fontSize: '10px', color: isActive ? '#e0ecff' : '#444', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {node.item_name}
                                      </div>
                                      {((node.attribute_value_ids || []).length > 0 || node.bom_size_id) && (
                                          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginTop: 2 }}>
                                              {(node.attribute_value_ids || []).map((id: string) => (
                                                  <span key={id} style={{ fontSize: '8px', padding: '0 4px', background: isActive ? 'rgba(219,234,254,0.25)' : '#dbeafe', color: isActive ? '#bfdbfe' : '#1d4ed8', borderRadius: 2, fontWeight: 700, lineHeight: '14px' }}>
                                                      {getAttributeValueName(id)}
                                                  </span>
                                              ))}
                                              {node.bom_size_id && (() => {
                                                  const label = getBomSizeLabel(node.bom_id, node.bom_size_id);
                                                  return label ? (
                                                      <span style={{ fontSize: '8px', padding: '0 4px', background: isActive ? 'rgba(220,252,231,0.25)' : '#dcfce7', color: isActive ? '#bbf7d0' : '#15803d', borderRadius: 2, fontWeight: 700, lineHeight: '14px' }}>
                                                          <i className="bi bi-rulers me-1" style={{ fontSize: '7px' }}></i>{label}
                                                      </span>
                                                  ) : null;
                                              })()}
                                          </div>
                                      )}
                                  </div>
                                  <span style={{ fontSize: '8px', background: statusColor, color: '#fff', padding: '1px 4px', borderRadius: classic ? '0' : '2px', whiteSpace: 'nowrap', alignSelf: 'center', flexShrink: 0 }}>
                                      {node.status === 'IN_PROGRESS' ? 'IN PROG' : node.status}
                                  </span>
                              </div>
                          );
                      })}
                  </div>
              </div>

              {/* ── CENTRE: BOM Components ── */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {/* Detail header */}
                  <div style={{
                      background: classic ? 'linear-gradient(to bottom,#fff,#e8e4d8)' : '#fff',
                      borderBottom: classic ? '1px solid #808080' : '1px solid #dee2e6',
                      padding: '5px 10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap'
                  }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', fontWeight: 'bold', color: '#000' }}>{selectedNode.code}</span>
                      <span style={{ fontSize: '12px', color: '#000' }}>{selectedNode.item_name}</span>
                      {(selectedNode.attribute_value_ids || []).map((id: string) => (
                          <span key={id} style={{ fontSize: '9px', padding: '1px 6px', background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: 2, fontWeight: 700 }}>
                              {getAttributeValueName(id)}
                          </span>
                      ))}
                      {selectedNode.bom_size_id && (() => {
                          const label = getBomSizeLabel(selectedNode.bom_id, selectedNode.bom_size_id);
                          return label ? (
                              <span style={{ fontSize: '9px', padding: '1px 6px', background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: 2, fontWeight: 700 }}>
                                  <i className="bi bi-rulers me-1"></i>{label}
                              </span>
                          ) : null;
                      })()}
                      {bom && <span style={{ fontSize: '10px', color: '#444' }}>BOM: <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#000' }}>{bom.code}</span></span>}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                          {selectedNode.status === 'PENDING' && (
                              <button className="btn btn-sm btn-primary py-0 px-2" style={{ fontSize: '0.72rem' }} onClick={() => onUpdateStatus(selectedNode.id, 'IN_PROGRESS')}>
                                  <i className="bi bi-play-fill me-1"></i>Start
                              </button>
                          )}
                          {selectedNode.status === 'IN_PROGRESS' && (
                              <button className="btn btn-sm btn-success py-0 px-2" style={{ fontSize: '0.72rem' }} onClick={() => setCompletionMO(selectedNode)}>
                                  <i className="bi bi-check-lg me-1"></i>Log
                              </button>
                          )}
                          <button
                              title="Print this MO"
                              className={classic ? '' : 'btn btn-sm btn-outline-secondary py-0 px-2'}
                              style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '10px', padding: '1px 8px', background: 'linear-gradient(to bottom,#f0efe6,#dddbd0)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', cursor: 'pointer', color: '#000' } : { fontSize: '0.72rem' }}
                              onClick={() => handlePrintWO(selectedNode, true)}
                          >
                              <i className="bi bi-printer me-1"></i>Print
                          </button>
                      </div>
                  </div>

                  {/* Section title */}
                  <div style={{
                      background: classic ? '#d4d0c8' : '#f1f3f5',
                      borderBottom: classic ? '1px solid #808080' : '1px solid #dee2e6',
                      padding: '2px 10px', fontSize: '10px', fontWeight: 'bold', color: '#000',
                      display: 'flex', alignItems: 'center', gap: '6px'
                  }}>
                      <i className="bi bi-boxes"></i>BOM Components
                      {!bom && <span style={{ fontWeight: 'normal', color: '#888' }}>— No BOM linked</span>}
                  </div>

                  {/* Components table */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                      {bom ? (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                              <thead>
                                  <tr style={{ background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#f8f9fa', position: 'sticky', top: 0 }}>
                                      {['Component', 'Variant', 'Required', 'In Stock', 'Source'].map(h => (
                                          <th key={h} style={{ border: classic ? '1px solid #808080' : '1px solid #dee2e6', padding: '3px 6px', textAlign: h === 'Required' || h === 'In Stock' ? 'right' : 'left', color: '#000', fontSize: '10px' }}>{h}</th>
                                      ))}
                                  </tr>
                              </thead>
                              <tbody>
                                  {bom.lines.map((line: any, i: number) => {
                                      const req = calculateRequiredQty(selectedNode.qty, line, bom);
                                      const locId = line.source_location_id || selectedNode.source_location_id || selectedNode.location_id;
                                      const { available, isEnough } = checkStockAvailability(line.item_id, locId, line.attribute_value_ids || [], req);
                                      const hasSubBOM = boms.some((b: any) => b.item_id === line.item_id && b.active !== false);
                                      const attrLabel = (line.attribute_value_ids || []).map(getAttributeValueName).filter(Boolean).join(', ');
                                      const rowBg = i % 2 === 0 ? '#fff' : (classic ? '#f5f3ee' : '#f8f9fa');
                                      const stockLevel = isEnough ? 'ok' : available > 0 ? 'low' : 'out';
                                      const dotStyle: Record<string, { dot: string; border: string }> = {
                                          ok:  { dot: '#00aa00', border: '#005500' },
                                          low: { dot: '#ccaa00', border: '#886600' },
                                          out: { dot: '#cc0000', border: '#660000' },
                                      };
                                      const dc = dotStyle[stockLevel];
                                      return (
                                          <tr key={line.id} style={{ background: rowBg }}>
                                              <td style={{ border: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: '3px 6px', color: '#000' }}>
                                                  <div style={{ fontWeight: 500 }}>{line.item_name || getItemName(line.item_id)}</div>
                                                  <div style={{ fontSize: '9px', color: '#555', fontFamily: 'monospace' }}>{line.item_code || getItemCode(line.item_id)}</div>
                                                  {hasSubBOM && <span style={{ fontSize: '8px', background: '#fff3cd', border: '1px solid #b8860b', color: '#6b4e00', padding: '0 4px', fontWeight: 'bold' }}>SUB-BOM</span>}
                                              </td>
                                              <td style={{ border: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: '3px 6px', color: '#333', fontSize: '10px' }}>{attrLabel || '—'}</td>
                                              <td style={{ border: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: '3px 6px', textAlign: 'right', fontFamily: 'monospace', color: '#000', fontWeight: 'bold' }}>{req.toFixed(2)}</td>
                                              <td style={{ border: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: '3px 6px', textAlign: 'right' }}>
                                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                                      <span style={{ fontFamily: 'monospace', color: isEnough ? '#004400' : available > 0 ? '#664400' : '#880000', fontWeight: 'bold' }}>{available.toFixed(2)}</span>
                                                      <span style={{ display: 'inline-block', width: 8, height: 8, background: dc.dot, border: `1px solid ${dc.border}`, flexShrink: 0 }} />
                                                      {stockLevel === 'low' && <span style={{ fontSize: 8, background: '#886600', color: '#fff', padding: '0 3px', fontWeight: 'bold' }}>Low</span>}
                                                      {stockLevel === 'out' && <span style={{ fontSize: 8, background: '#880000', color: '#fff', padding: '0 3px', fontWeight: 'bold' }}>Out</span>}
                                                  </div>
                                              </td>
                                              <td style={{ border: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: '3px 6px', color: '#444', fontSize: '10px' }}>{getLocationName(locId)}</td>
                                          </tr>
                                      );
                                  })}
                              </tbody>
                          </table>
                      ) : (
                          <div style={{ padding: '16px', color: '#555', fontSize: '11px', textAlign: 'center' }}>No BOM lines to display for this manufacturing order.</div>
                      )}
                  </div>
              </div>

              {/* ── RIGHT: Meta + QR ── */}
              <div style={{
                  width: '170px', minWidth: '170px',
                  borderLeft: classic ? '2px solid #808080' : '1px solid #dee2e6',
                  background: classic ? '#fafaf7' : '#fff',
                  display: 'flex', flexDirection: 'column'
              }}>
                  {/* Timeline */}
                  <div style={{ borderBottom: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: '6px 8px' }}>
                      <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', marginBottom: '4px' }}>Timeline</div>
                      {([
                          { label: 'Target S', val: formatDate(selectedNode.target_start_date), warn: null },
                          { label: 'Target E', val: formatDate(selectedNode.target_end_date), warn: getDueDateWarning(selectedNode) },
                          { label: 'Actual S', val: formatDateTime(selectedNode.actual_start_date), warn: null },
                          { label: 'Actual E', val: formatDateTime(selectedNode.actual_end_date), warn: null },
                      ] as {label:string;val:string;warn:any}[]).map(({ label, val, warn }) => (
                          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
                              <span style={{ color: '#555' }}>{label}:</span>
                              <span style={{ fontWeight: 'bold', color: warn ? '#c00000' : '#000' }}>{val}</span>
                          </div>
                      ))}
                  </div>

                  {/* Output */}
                  <div style={{ borderBottom: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: '6px 8px' }}>
                      <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', marginBottom: '4px' }}>Output</div>
                      <div style={{ fontSize: '10px', color: '#000', fontWeight: 'bold' }}>{getLocationName(selectedNode.location_id)}</div>
                      <div style={{ fontSize: '10px', color: '#444' }}>Qty: <strong style={{ color: '#000' }}>{selectedNode.qty}</strong></div>
                  </div>

                  {/* Completion Progress */}
                  {(selectedNode.status === 'IN_PROGRESS' || selectedNode.status === 'COMPLETED' || (selectedNode.qty_completed_total ?? 0) > 0) && (() => {
                      const done = selectedNode.qty_completed_total ?? 0;
                      const total = selectedNode.qty ?? 0;
                      const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
                      return (
                          <div style={{ borderBottom: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: '6px 8px' }}>
                              <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', marginBottom: '4px' }}>
                                  Production Progress
                              </div>
                              {/* XP-style striped progress bar */}
                              <div style={{ border: '1px solid #7f9db9', height: 13, background: '#fff', position: 'relative', overflow: 'hidden', marginBottom: 3 }}>
                                  <div style={{
                                      height: '100%', width: `${pct}%`,
                                      background: pct >= 100
                                          ? 'repeating-linear-gradient(45deg,#2e7d32,#2e7d32 3px,#4caf50 3px,#4caf50 6px)'
                                          : 'repeating-linear-gradient(45deg,#000080,#000080 3px,#1565c0 3px,#1565c0 6px)',
                                      transition: 'width 0.2s',
                                  }} />
                                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 'bold', color: pct > 50 ? '#fff' : '#000080' }}>
                                      {pct}%
                                  </span>
                              </div>
                              <div style={{ fontSize: '9px', color: '#555', display: 'flex', justifyContent: 'space-between' }}>
                                  <span>Done: <strong style={{ color: '#000' }}>{done.toFixed(2)}</strong></span>
                                  <span>Left: <strong style={{ color: done >= total ? '#1a6e1a' : '#c00' }}>{Math.max(0, total - done).toFixed(2)}</strong></span>
                              </div>
                              {selectedNode.status === 'IN_PROGRESS' && (
                                  <button
                                      onClick={() => setCompletionMO(selectedNode)}
                                      style={{ marginTop: 5, width: '100%', fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '10px', padding: '2px 0', background: 'linear-gradient(to bottom,#b0e8b0,#70c870)', border: '1px solid', borderColor: '#d0f0d0 #0a3e0a #0a3e0a #1a5e1a', cursor: 'pointer', fontWeight: 'bold', color: '#004000' }}
                                  >
                                      + Log Entry
                                  </button>
                              )}
                          </div>
                      );
                  })()}

                  {/* Batch Trace */}
                  <div style={{ borderBottom: classic ? '1px solid #c0bdb5' : '1px solid #dee2e6', padding: '6px 8px' }}>
                      <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', marginBottom: '4px' }}>
                          <i className="bi bi-upc-scan me-1"></i>Batches
                      </div>
                      {(() => {
                          const trace: any[] = selectedNode.batch_trace || [];
                          if (trace.length === 0) {
                              return <div style={{ fontSize: '9px', color: '#999', fontStyle: 'italic' }}>No batch recorded</div>;
                          }
                          const outputBatch = trace[0]?.output_batch_number;
                          return (
                              <>
                                  {outputBatch && (
                                      <div style={{ fontSize: '10px', marginBottom: '4px' }}>
                                          <span style={{ color: '#555', fontSize: '9px' }}>Output: </span>
                                          <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#1a6e1a', fontSize: '10px', background: '#f0fdf4', border: '1px solid #86efac', padding: '0 4px', borderRadius: 2 }}>
                                              {outputBatch}
                                          </span>
                                      </div>
                                  )}
                                  <div style={{ fontSize: '9px', color: '#555', marginBottom: '2px' }}>Input batches:</div>
                                  {trace.map((c: any, i: number) => (
                                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px', fontSize: '9px' }}>
                                          <span style={{ fontFamily: 'monospace', color: '#1d4ed8', background: '#eff6ff', border: '1px solid #93c5fd', padding: '0 3px', borderRadius: 2, fontSize: '9px' }}>
                                              {c.input_batch_number}
                                          </span>
                                          <span style={{ color: '#666', fontSize: '9px' }}>{Number(c.qty_consumed).toFixed(2)}</span>
                                      </div>
                                  ))}
                              </>
                          );
                      })()}
                  </div>

                  {/* QR + Scan */}
                  <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', flex: 1 }}>
                      <div style={{ fontSize: '9px', fontWeight: 'bold', textTransform: 'uppercase', color: '#555', letterSpacing: '0.5px', alignSelf: 'flex-start' }}>QR Code</div>
                      {qrDataUrls[selectedNode.code] ? (
                          <img src={qrDataUrls[selectedNode.code]} alt="QR" style={{ width: '90px', height: '90px', border: '2px solid #000' }} />
                      ) : (
                          <div style={{ width: '90px', height: '90px', background: '#eee', border: '1px solid #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: '#888' }}>Loading...</div>
                      )}
                      <div style={{ fontFamily: 'monospace', fontSize: '8px', color: '#000', textAlign: 'center', wordBreak: 'break-all' }}>{selectedNode.code}</div>
                      <button
                          style={{
                              width: '100%', padding: '3px 0', fontSize: '10px',
                              background: classic ? 'linear-gradient(to bottom,#fff,#d4d0c8)' : '#e9ecef',
                              border: classic ? '1px solid #808080' : '1px solid #ced4da',
                              cursor: 'pointer', color: '#000', fontFamily: 'inherit', fontWeight: 'bold'
                          }}
                          onClick={() => router.push('/scanner')}
                      >
                          <i className="bi bi-qr-code-scan me-1"></i>Scan
                      </button>
                  </div>
              </div>
          </div>

          {/* ── BOTTOM: Operation Steps ── */}
          <div style={{ marginTop: 10, borderTop: '1px solid #d4d0c8', paddingTop: 8, padding: '8px 12px' }}>
              <WorkOrderPanel
                  manufacturingOrderId={selectedNode.id}
                  workOrders={selectedNode.work_orders || []}
                  workCenters={workCenters || []}
                  onAdd={onCreateWO}
                  onUpdate={onUpdateWO}
                  onUpdateStatus={onUpdateWOStatus}
                  onDelete={onDeleteWO}
              />
          </div>
      </>
      );
  };

  return (
      <div className="row g-4 fade-in print-container">
          {printPreviewWO && (
            <WOPrintModal
                wo={printPreviewWO}
                onClose={() => setPrintPreviewWO(null)}
                printSettings={printSettings}
                onPrintSettingsChange={setPrintSettings}
                currentStyle={currentStyle}
                companyProfile={companyProfile}
                boms={boms}
                getItemName={getItemName}
                getItemCode={getItemCode}
                getLocationName={getLocationName}
                getAttributeValueName={getAttributeValueName}
                formatDate={formatDate}
                hideChildMOs={printHideChildren}
            />
        )}

          <CodeConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} type="MO" onSave={handleSaveConfig} initialConfig={codeConfig} attributes={attributes} />

          <ModalWrapper
              isOpen={isCreateOpen}
              onClose={() => setIsCreateOpen(false)}
              title={<><i className="bi bi-gear-wide-connected me-1"></i> NEW MANUFACTURING ORDER</>}
              variant="success"
              size="xxl"
              footer={
                  <>
                      <button type="button" className="btn btn-sm btn-link text-muted text-decoration-none" onClick={() => setIsCreateOpen(false)}>{t('cancel')}</button>
                      <button type="button" className="btn btn-sm btn-success px-4 fw-bold shadow-sm" onClick={handleSubmit} disabled={isSubmitting}>{isSubmitting ? 'Creating...' : 'CREATE MANUFACTURING ORDER'}</button>
                  </>
              }
          >
              {/* Two-panel layout: left=form, right=live preview */}
              <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>

                  {/* ── LEFT: Form ── */}
                  <div style={{
                      width: 380, minWidth: 380, flexShrink: 0,
                      paddingRight: 20,
                      borderRight: `1px solid ${currentStyle === 'classic' ? '#aca899' : '#e2e8f0'}`,
                  }}>
                      {/* Variant context badge */}
                      {(() => {
                          const bom = boms.find((b: any) => b.id === newWO.bom_id);
                          const attrNames: string[] = bom ? (bom.attribute_value_ids || []).map(getAttributeValueName).filter(Boolean) : [];
                          const sizeLabel = bom && newWO.bom_size_id ? getBomSizeLabel(bom.id, newWO.bom_size_id) : '';
                          if (!attrNames.length && !sizeLabel) return null;
                          return (
                              <div className="mb-2 px-2 py-1 rounded" style={{ background: '#f6f8ff', border: '1px solid #c8d8f8' }}>
                                  <div className="extra-small fw-bold text-muted mb-1" style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                      <i className="bi bi-tag-fill me-1 text-primary opacity-75"></i>Product Variant
                                  </div>
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                      {attrNames.map((name: string, i: number) => (
                                          <span key={i} style={{ fontSize: 10, padding: '1px 6px', background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: 3, fontWeight: 700 }}>{name}</span>
                                      ))}
                                      {sizeLabel && (
                                          <span style={{ fontSize: 10, padding: '1px 6px', background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: 3, fontWeight: 700 }}>
                                              <i className="bi bi-rulers me-1"></i>{sizeLabel}
                                          </span>
                                      )}
                                  </div>
                              </div>
                          );
                      })()}

                      {/* MO Details */}
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#888', borderBottom: `1px solid ${currentStyle === 'classic' ? '#c0bdb5' : '#e2e8f0'}`, paddingBottom: 2, marginBottom: 8 }}>MO Details</div>

                      <div className="mb-2">
                          <label className="form-label extra-small fw-bold text-muted uppercase mb-1">MO Reference Code</label>
                          <div style={{ display: 'flex' }}>
                              <input
                                  placeholder="Auto-generated"
                                  value={newWO.code}
                                  onChange={e => setNewWO({...newWO, code: e.target.value})}
                                  required
                                  style={{ flex: 1, fontFamily: 'Tahoma, "Segoe UI", sans-serif', fontSize: 11, border: '1px solid #7f9db9', borderRight: 'none', background: 'white', height: 24, padding: '0 4px', outline: 'none', borderRadius: 0, boxSizing: 'border-box' as const }}
                              />
                              <button
                                  type="button"
                                  onClick={() => setIsConfigOpen(true)}
                                  style={{ fontFamily: 'Tahoma, "Segoe UI", sans-serif', fontSize: 11, height: 24, padding: '0 7px', background: 'linear-gradient(to bottom, #f0efe6, #dddbd0)', border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', borderRadius: 0, cursor: 'pointer', boxSizing: 'border-box' as const }}
                                  title="Configure code format"
                              ><i className="bi bi-gear-fill" style={{ fontSize: 10 }}></i></button>
                          </div>
                      </div>

                      <div className="mb-2">
                          <label className="form-label extra-small fw-bold text-muted uppercase mb-1">Target Quantity</label>
                          <input type="number" className="form-control form-control-sm" value={newWO.qty} onChange={e => setNewWO({...newWO, qty: parseFloat(e.target.value)})} required />
                      </div>

                      <div className="mb-2">
                          <label className="form-label extra-small fw-bold text-muted uppercase mb-1">Product Recipe (BOM)</label>
                          <SearchableSelect
                              options={boms.map((b: any) => ({ value: b.id, label: `[${b.code}]  ${getItemName(b.item_id)}` }))}
                              value={newWO.bom_id}
                              onChange={handleBOMChange}
                              required
                              placeholder="Choose a product recipe..."
                          />
                      </div>

                      {/* Schedule */}
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#888', borderBottom: `1px solid ${currentStyle === 'classic' ? '#c0bdb5' : '#e2e8f0'}`, paddingBottom: 2, marginBottom: 8, marginTop: 14 }}>Schedule</div>
                      <div className="row g-2 mb-2">
                          <div className="col-6">
                              <label className="form-label extra-small fw-bold text-muted uppercase mb-1">Start Date</label>
                              <input type="date" className="form-control form-control-sm" value={newWO.target_start_date} onChange={e => setNewWO({...newWO, target_start_date: e.target.value})} />
                          </div>
                          <div className="col-6">
                              <label className="form-label extra-small fw-bold text-muted uppercase mb-1">End Date</label>
                              <input type="date" className="form-control form-control-sm" value={newWO.target_end_date} onChange={e => setNewWO({...newWO, target_end_date: e.target.value})} />
                          </div>
                      </div>

                      {/* Locations */}
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#888', borderBottom: `1px solid ${currentStyle === 'classic' ? '#c0bdb5' : '#e2e8f0'}`, paddingBottom: 2, marginBottom: 8, marginTop: 14 }}>Locations</div>
                      <div className="mb-2">
                          <label className="form-label extra-small fw-bold text-muted uppercase mb-1">Output Target</label>
                          <select className="form-select form-select-sm" value={newWO.location_code} onChange={e => setNewWO({...newWO, location_code: e.target.value})} required>
                              <option value="">Select...</option>
                              {locations.map((loc: any) => <option key={loc.id} value={loc.code}>{loc.name}</option>)}
                          </select>
                      </div>
                      <div className="mb-2">
                          <label className="form-label extra-small fw-bold text-muted uppercase mb-1">Material Source</label>
                          <select className="form-select form-select-sm" value={newWO.source_location_code} onChange={e => setNewWO({...newWO, source_location_code: e.target.value})}>
                              <option value="">Same as Production</option>
                              {locations.map((loc: any) => <option key={loc.id} value={loc.code}>{loc.name}</option>)}
                          </select>
                      </div>

                      {/* Nested toggle — clean */}
                      <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${currentStyle === 'classic' ? '#aca899' : '#e2e8f0'}` }}>
                          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', margin: 0 }}>
                              <input
                                  type="checkbox"
                                  checked={newWO.create_nested}
                                  onChange={e => setNewWO({...newWO, create_nested: e.target.checked})}
                                  style={{ marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
                              />
                              <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: currentStyle === 'classic' ? '#000084' : '#1e40af' }}>
                                      <i className="bi bi-diagram-3-fill me-1"></i>
                                      Create child MOs for nested BOMs
                                  </div>
                                  <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>
                                      Auto-generates sub-assembly orders for all nested recipes
                                  </div>
                              </div>
                          </label>
                      </div>
                  </div>

                  {/* ── RIGHT: Live Preview ── */}
                  <div style={{ flex: 1, paddingLeft: 20, minHeight: 280 }}>
                      {newWO.bom_id && newWO.qty > 0 ? (
                          <MOCreationPreview
                              bomId={newWO.bom_id}
                              qty={newWO.qty}
                              locationCode={newWO.location_code}
                              sourceLocationCode={newWO.source_location_code}
                              createNested={newWO.create_nested}
                              boms={boms}
                              locations={locations}
                              stockBalance={stockBalance}
                          />
                      ) : (
                          <div style={{
                              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                              height: '100%', minHeight: 280, gap: 10,
                              color: currentStyle === 'classic' ? '#888' : '#94a3b8',
                          }}>
                              <i className="bi bi-diagram-3" style={{ fontSize: 40, opacity: 0.35 }}></i>
                              <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 200 }}>
                                  Select a BOM and enter quantity to preview the MO
                              </div>
                          </div>
                      )}
                  </div>

              </div>
          </ModalWrapper>

          <div className="col-12 flex-print-fill">
              {/* ── Outer window shell ── */}
              <div style={{
                  border: currentStyle === 'classic' ? '2px solid' : undefined,
                  borderColor: currentStyle === 'classic' ? '#dfdfdf #808080 #808080 #dfdfdf' : undefined,
                  borderRadius: 0,
                  boxShadow: currentStyle === 'classic' ? '2px 2px 4px rgba(0,0,0,0.3)' : undefined,
                  background: currentStyle === 'classic' ? '#ece9d8' : undefined,
              }} className={currentStyle === 'classic' ? '' : 'card h-100 border-0 shadow-sm'}>

                  {/* ── Title bar / toolbar ── */}
                  <div
                      className="no-print"
                      style={{
                          background: currentStyle === 'classic'
                              ? 'linear-gradient(to right, #0058e6 0%, #08a5ff 100%)'
                              : '#fff',
                          borderBottom: currentStyle === 'classic' ? '1px solid #003080' : '1px solid #dee2e6',
                          padding: currentStyle === 'classic' ? '4px 8px' : '8px 16px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          boxShadow: currentStyle === 'classic' ? 'inset 0 1px 0 rgba(255,255,255,0.3)' : undefined,
                      }}
                  >
                      {/* Left: title + view switcher */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{
                              fontFamily: currentStyle === 'classic' ? 'Tahoma, Arial, sans-serif' : undefined,
                              fontSize: currentStyle === 'classic' ? '12px' : undefined,
                              fontWeight: 'bold',
                              color: currentStyle === 'classic' ? '#fff' : '#000',
                              textShadow: currentStyle === 'classic' ? '1px 1px 1px rgba(0,0,0,0.4)' : undefined,
                              letterSpacing: currentStyle === 'classic' ? '0.3px' : undefined,
                          }}>
                              <i className={`bi ${activeTab === 'manufacturing-orders' ? 'bi-list-task' : 'bi-collection-play'} me-2`} style={{ fontSize: '13px' }}></i>
                              {activeTab === 'manufacturing-orders' ? (t('manufacturing_orders') || 'Manufacturing Orders') : 'Production Runs'}
                          </span>

                          {/* View-mode buttons */}
                          <div style={{ display: 'flex', gap: currentStyle === 'classic' ? '2px' : '0' }}>
                              {[
                                  { key: 'calendar', icon: 'bi-calendar-event', label: 'Calendar' },
                                  { key: 'list',     icon: 'bi-list-ul',        label: 'List' },
                                  { key: 'scanner',  icon: 'bi-qr-code-scan',   label: 'Scanner' },
                              ].map(({ key, icon, label }) => {
                                  const isActive = viewMode === key;
                                  const handleClick = () => key === 'scanner' ? router.push('/scanner') : setViewMode(key);
                                  if (currentStyle === 'classic') {
                                      return (
                                          <button
                                              key={key}
                                              onClick={handleClick}
                                              style={{
                                                  fontFamily: 'Tahoma, Arial, sans-serif',
                                                  fontSize: '11px',
                                                  padding: '2px 8px',
                                                  background: isActive
                                                      ? 'linear-gradient(to bottom,#fff 0%,#d4d0c8 100%)'
                                                      : 'linear-gradient(to bottom,#d4d0c8 0%,#b8b4ac 100%)',
                                                  border: '1px solid',
                                                  borderColor: isActive
                                                      ? '#808080 #dfdfdf #dfdfdf #808080'
                                                      : '#dfdfdf #808080 #808080 #dfdfdf',
                                                  color: '#000',
                                                  cursor: 'pointer',
                                                  fontWeight: isActive ? 'bold' : 'normal',
                                              }}
                                          >
                                              <i className={`bi ${icon} me-1`}></i>{label}
                                          </button>
                                      );
                                  }
                                  return (
                                      <button key={key} className={`btn btn-sm btn-light border ${isActive ? 'active' : ''}`} onClick={handleClick}>
                                          <i className={`bi ${icon} me-1`}></i>{label}
                                      </button>
                                  );
                              })}
                          </div>
                      </div>

                      {/* Right: New Production Run + Create MO + Print */}
                      <div style={{ display: 'flex', gap: '6px' }}>
                          {currentStyle === 'classic' ? (
                              <>
                                  <button
                                      onClick={() => setIsPRModalOpen(true)}
                                      style={{
                                          fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px',
                                          padding: '2px 10px', cursor: 'pointer', fontWeight: 'bold',
                                          background: 'linear-gradient(to bottom,#5a9ae0,#0058e6)',
                                          border: '1px solid', borderColor: '#003080 #001840 #001840 #003080',
                                          color: '#fff',
                                      }}
                                  >
                                      <i className="bi bi-collection-play me-1"></i>New Production Run
                                  </button>
                                  <button
                                      onClick={() => setIsCreateOpen(true)}
                                      style={{
                                          fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px',
                                          padding: '2px 10px', cursor: 'pointer', fontWeight: 'bold',
                                          background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)',
                                          border: '1px solid', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a',
                                          color: '#fff',
                                      }}
                                  >
                                      <i className="bi bi-plus-lg me-1"></i>New MO
                                  </button>
                                  <button
                                      onClick={handlePrintList}
                                      style={{
                                          fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px',
                                          padding: '2px 10px', cursor: 'pointer',
                                          background: 'linear-gradient(to bottom,#fff,#d4d0c8)',
                                          border: '1px solid', borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                                          color: '#000',
                                      }}
                                  >
                                      <i className="bi bi-printer me-1"></i>{t('print')}
                                  </button>
                              </>
                          ) : (
                              <>
                                  <button className="btn btn-primary btn-sm" onClick={() => setIsPRModalOpen(true)}><i className="bi bi-collection-play me-1"></i>New Production Run</button>
                                  <button className="btn btn-success btn-sm text-white" onClick={() => setIsCreateOpen(true)}><i className="bi bi-plus-lg me-1"></i>New MO</button>
                                  <button className="btn btn-outline-primary btn-sm btn-print" onClick={handlePrintList}><i className="bi bi-printer me-1"></i>{t('print')}</button>
                              </>
                          )}
                      </div>
                  </div>

                  {/* ── Tab bar ── */}
                  {showTabSwitcher && <div className="no-print" style={{
                      background: currentStyle === 'classic' ? '#ece9d8' : '#f8f9fa',
                      borderBottom: currentStyle === 'classic' ? '1px solid #808080' : '1px solid #dee2e6',
                      display: 'flex', gap: currentStyle === 'classic' ? '0' : '4px',
                      padding: currentStyle === 'classic' ? '4px 8px 0' : '6px 12px 0',
                  }}>
                      {[
                          { key: 'production-runs', label: 'Production Runs', icon: 'bi-collection-play' },
                          { key: 'manufacturing-orders', label: 'Manufacturing Orders', icon: 'bi-list-task' },
                      ].map(({ key, label, icon }) => {
                          const isActive = activeTab === key;
                          if (currentStyle === 'classic') {
                              return (
                                  <button
                                      key={key}
                                      onClick={() => setActiveTab(key as any)}
                                      style={{
                                          fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px',
                                          padding: '3px 12px',
                                          background: isActive ? '#ece9d8' : 'linear-gradient(to bottom,#d4d0c8,#b8b4ac)',
                                          border: '1px solid #808080',
                                          borderBottom: isActive ? '1px solid #ece9d8' : '1px solid #808080',
                                          color: '#000', cursor: 'pointer',
                                          fontWeight: isActive ? 'bold' : 'normal',
                                          marginRight: 2, position: 'relative', top: 1,
                                      }}
                                  >
                                      <i className={`bi ${icon} me-1`}></i>{label}
                                  </button>
                              );
                          }
                          return (
                              <button key={key}
                                  onClick={() => setActiveTab(key as any)}
                                  style={{
                                      fontSize: '12px', padding: '4px 14px', cursor: 'pointer',
                                      background: isActive ? '#fff' : 'transparent',
                                      border: '1px solid',
                                      borderColor: isActive ? '#dee2e6 #dee2e6 #fff' : 'transparent',
                                      borderBottom: isActive ? '1px solid #fff' : '1px solid transparent',
                                      fontWeight: isActive ? 'bold' : 'normal',
                                      color: isActive ? '#000' : '#555',
                                      borderRadius: '4px 4px 0 0',
                                  }}
                              >
                                  <i className={`bi ${icon} me-1`}></i>{label}
                              </button>
                          );
                      })}
                  </div>}

                  {/* ── Body ── */}
                  <div style={{ background: currentStyle === 'classic' ? '#ece9d8' : undefined }} className={currentStyle === 'classic' ? '' : 'card-body p-0'}>

                      {/* Production Runs tab content */}
                      {activeTab === 'production-runs' && (
                          <div>
                              {productionRuns && productionRuns.length > 0 ? (
                                  <div className="table-responsive">
                                      <table style={{
                                          width: '100%', borderCollapse: 'collapse',
                                          fontFamily: currentStyle === 'classic' ? 'Tahoma, Arial, sans-serif' : undefined,
                                          fontSize: currentStyle === 'classic' ? '11px' : undefined,
                                          background: currentStyle === 'classic' ? '#fff' : undefined,
                                      }} className={currentStyle === 'classic' ? '' : 'table table-hover align-middle mb-0'}>
                                          <thead>
                                              <tr style={{
                                                  background: currentStyle === 'classic' ? 'linear-gradient(to bottom,#fff 0%,#d4d0c8 100%)' : undefined,
                                                  fontSize: currentStyle === 'classic' ? '10px' : '9pt',
                                              }} className={currentStyle === 'classic' ? '' : 'table-light'}>
                                                  {['Code', 'BOM / Style', 'MOs', 'Progress', 'Status', 'Due Date', 'Actions'].map(h => (
                                                      <th key={h} style={{
                                                          border: currentStyle === 'classic' ? '1px solid #808080' : undefined,
                                                          padding: currentStyle === 'classic' ? '3px 8px' : undefined,
                                                          color: '#000', fontWeight: 'bold', whiteSpace: 'nowrap',
                                                          textAlign: h === 'Actions' ? 'right' : 'left',
                                                      }}>{h}</th>
                                                  ))}
                                              </tr>
                                          </thead>
                                          <tbody>
                                              {productionRuns.map((pr: any, rowIdx: number) => {
                                                  const mos = pr.manufacturing_orders || [];
                                                  const done = mos.filter((m: any) => m.status === 'COMPLETED').length;
                                                  const total = mos.length;
                                                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                                                  const rowBg = currentStyle === 'classic'
                                                      ? (rowIdx % 2 === 0 ? '#fff' : '#f5f3ee')
                                                      : undefined;
                                                  const tdStyle: React.CSSProperties = currentStyle === 'classic' ? {
                                                      border: '1px solid #c0bdb5', padding: '4px 8px', color: '#000', verticalAlign: 'middle',
                                                  } : {};
                                                  const isExpanded = !!expandedPRs[pr.id];
                                                  const reqs: any[] = prMaterialReqs[pr.id] || [];
                                                  const isLoading = !!prMaterialReqsLoading[pr.id];
                                                  const hasShortfall = reqs.some((r: any) => r.shortfall > 0);
                                                  return (
                                                      <React.Fragment key={pr.id}>
                                                      <tr style={{ background: rowBg }}>
                                                          <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 'bold' }}>{pr.code}</td>
                                                          <td style={tdStyle}>
                                                              <div style={{ fontWeight: 'bold', fontSize: currentStyle === 'classic' ? '11px' : undefined }}>
                                                                  {pr.bom?.item_name || pr.bom?.item_code || pr.bom?.code || pr.bom_id}
                                                              </div>
                                                              {pr.bom?.code && (
                                                                  <div style={{ fontSize: 9, color: '#666', fontFamily: 'monospace' }}>{pr.bom.code}</div>
                                                              )}
                                                          </td>
                                                          <td style={{ ...tdStyle, textAlign: 'center' }}>{total}</td>
                                                          <td style={{ ...tdStyle, minWidth: 120 }}>
                                                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                  <div style={{ flex: 1, height: 10, background: '#ddd', borderRadius: 2, border: currentStyle === 'classic' ? '1px solid #808080' : undefined, overflow: 'hidden' }}>
                                                                      <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#2d7a2d' : '#0058e6', transition: 'width 0.3s' }} />
                                                                  </div>
                                                                  <span style={{ fontSize: 10, fontFamily: 'monospace', minWidth: 32 }}>{pct}%</span>
                                                              </div>
                                                              <div style={{ fontSize: 9, color: '#666' }}>{done}/{total} done</div>
                                                          </td>
                                                          <td style={tdStyle}>
                                                              {currentStyle === 'classic' ? (
                                                                  (() => {
                                                                      const chipStyle: React.CSSProperties = {
                                                                          display: 'inline-block', fontSize: '9px', fontWeight: 'bold',
                                                                          padding: '1px 6px', borderRadius: 0, border: '1px solid',
                                                                          fontFamily: 'Tahoma, Arial, sans-serif',
                                                                      };
                                                                      switch (pr.status) {
                                                                          case 'COMPLETED': return <span style={{ ...chipStyle, background: '#2d7a2d', borderColor: '#1a5e1a', color: '#fff' }}>COMPLETED</span>;
                                                                          case 'IN_PROGRESS': return <span style={{ ...chipStyle, background: '#0058e6', borderColor: '#003080', color: '#fff' }}>IN PROGRESS</span>;
                                                                          case 'CANCELLED': return <span style={{ ...chipStyle, background: '#c00000', borderColor: '#800000', color: '#fff' }}>CANCELLED</span>;
                                                                          default: return <span style={{ ...chipStyle, background: '#d4d0c8', borderColor: '#808080', color: '#333' }}>PENDING</span>;
                                                                      }
                                                                  })()
                                                              ) : (
                                                                  <span className={`badge ${getStatusBadge(pr.status)} extra-small`}>{pr.status}</span>
                                                              )}
                                                          </td>
                                                          <td style={{ ...tdStyle, fontSize: 10 }}>{formatDate(pr.target_end_date)}</td>
                                                          <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                              <button
                                                                  onClick={() => togglePR(pr.id)}
                                                                  title="Material Requirements"
                                                                  style={currentStyle === 'classic' ? {
                                                                      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '10px',
                                                                      padding: '2px 7px', cursor: 'pointer', border: '1px solid',
                                                                      background: isExpanded ? 'linear-gradient(to bottom,#d4d0c8,#fff)' : 'linear-gradient(to bottom,#fff,#d4d0c8)',
                                                                      borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
                                                                      color: hasShortfall && isExpanded ? '#c00000' : '#000', marginRight: 4,
                                                                  } : { marginRight: 4 }}
                                                                  className={currentStyle === 'classic' ? '' : `btn btn-sm btn-link p-0 ${hasShortfall && isExpanded ? 'text-danger' : 'text-secondary'}`}
                                                              >
                                                                  <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-list-check'}`}></i>
                                                                  {currentStyle === 'classic' && <span style={{ marginLeft: 3 }}>Materials</span>}
                                                              </button>
                                                              {currentStyle === 'classic' ? (
                                                                  <button onClick={() => onDeleteProductionRun(pr.id)} style={{
                                                                      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '10px',
                                                                      padding: '2px 7px', cursor: 'pointer', border: '1px solid',
                                                                      background: 'linear-gradient(to bottom,#fff,#d4d0c8)', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#c00000',
                                                                  }}>
                                                                      <i className="bi bi-trash me-1"></i>Del
                                                                  </button>
                                                              ) : (
                                                                  <button className="btn btn-sm btn-link text-danger p-0" onClick={() => onDeleteProductionRun(pr.id)} title="Delete Production Run">
                                                                      <i className="bi bi-trash fs-5"></i>
                                                                  </button>
                                                              )}
                                                          </td>
                                                      </tr>
                                                      {isExpanded && (
                                                          <tr style={{ background: currentStyle === 'classic' ? '#f0ede8' : '#f8f9fa' }}>
                                                              <td colSpan={7} style={{
                                                                  padding: currentStyle === 'classic' ? '6px 12px' : '8px 16px',
                                                                  border: currentStyle === 'classic' ? '1px solid #c0bdb5' : undefined,
                                                              }}>
                                                                  {isLoading ? (
                                                                      <span style={{ fontSize: 11, color: '#666', fontFamily: currentStyle === 'classic' ? 'Tahoma, Arial, sans-serif' : undefined }}>
                                                                          Loading material requirements...
                                                                      </span>
                                                                  ) : reqs.length === 0 ? (
                                                                      <span style={{ fontSize: 11, color: '#999', fontFamily: currentStyle === 'classic' ? 'Tahoma, Arial, sans-serif' : undefined }}>
                                                                          No component requirements found for this Production Run.
                                                                      </span>
                                                                  ) : (
                                                                      <div>
                                                                          <div style={{ fontSize: currentStyle === 'classic' ? 10 : 11, fontWeight: 'bold', marginBottom: 4, fontFamily: currentStyle === 'classic' ? 'Tahoma, Arial, sans-serif' : undefined, color: '#333' }}>
                                                                              Consolidated Material Requirements — {reqs.length} component{reqs.length !== 1 ? 's' : ''}
                                                                              {hasShortfall && <span style={{ marginLeft: 8, color: '#c00000', fontWeight: 'bold' }}>SHORTFALL DETECTED</span>}
                                                                          </div>
                                                                          <table style={{
                                                                              width: '100%', borderCollapse: 'collapse', fontSize: currentStyle === 'classic' ? 10 : 12,
                                                                              fontFamily: currentStyle === 'classic' ? 'Tahoma, Arial, sans-serif' : undefined,
                                                                          }}>
                                                                              <thead>
                                                                                  <tr style={{ background: currentStyle === 'classic' ? '#d4d0c8' : '#e9ecef' }}>
                                                                                      {['Item Code', 'Item Name', 'UOM', 'Total Required', 'Available', 'Shortfall', 'Contributing MOs'].map(h => (
                                                                                          <th key={h} style={{ padding: '2px 6px', textAlign: h === 'Total Required' || h === 'Available' || h === 'Shortfall' ? 'right' : 'left', border: currentStyle === 'classic' ? '1px solid #808080' : '1px solid #dee2e6', fontWeight: 'bold' }}>{h}</th>
                                                                                      ))}
                                                                                  </tr>
                                                                              </thead>
                                                                              <tbody>
                                                                                  {reqs.map((req: any, ri: number) => {
                                                                                      const short = req.shortfall > 0;
                                                                                      const rowColor = currentStyle === 'classic'
                                                                                          ? (short ? '#fff0f0' : ri % 2 === 0 ? '#fff' : '#f5f3ee')
                                                                                          : (short ? '#fff5f5' : ri % 2 === 0 ? '#fff' : '#f8f9fa');
                                                                                      const cellStyle: React.CSSProperties = {
                                                                                          padding: '2px 6px', border: currentStyle === 'classic' ? '1px solid #c0bdb5' : '1px solid #dee2e6',
                                                                                          background: rowColor, verticalAlign: 'middle',
                                                                                      };
                                                                                      const moSummary = (req.mo_contributions || []).map((c: any) => `${c.mo_code} (${parseFloat(c.required_qty).toFixed(2)})`).join(', ');
                                                                                      return (
                                                                                          <tr key={ri}>
                                                                                              <td style={{ ...cellStyle, fontFamily: 'monospace', fontWeight: 'bold' }}>{req.item_code}</td>
                                                                                              <td style={cellStyle}>{req.item_name}</td>
                                                                                              <td style={cellStyle}>{req.uom}</td>
                                                                                              <td style={{ ...cellStyle, textAlign: 'right', fontFamily: 'monospace' }}>{parseFloat(req.total_required).toFixed(2)}</td>
                                                                                              <td style={{ ...cellStyle, textAlign: 'right', fontFamily: 'monospace', color: short ? '#c00000' : '#2d7a2d', fontWeight: short ? 'bold' : undefined }}>
                                                                                                  {parseFloat(req.qty_available).toFixed(2)}
                                                                                              </td>
                                                                                              <td style={{ ...cellStyle, textAlign: 'right', fontFamily: 'monospace', color: short ? '#c00000' : '#2d7a2d', fontWeight: short ? 'bold' : undefined }}>
                                                                                                  {short ? `-${parseFloat(req.shortfall).toFixed(2)}` : 'OK'}
                                                                                              </td>
                                                                                              <td style={{ ...cellStyle, fontSize: currentStyle === 'classic' ? 9 : 11, color: '#555' }}>{moSummary}</td>
                                                                                          </tr>
                                                                                      );
                                                                                  })}
                                                                              </tbody>
                                                                          </table>
                                                                      </div>
                                                                  )}
                                                              </td>
                                                          </tr>
                                                      )}
                                                      </React.Fragment>
                                                  );
                                              })}
                                          </tbody>
                                      </table>
                                  </div>
                              ) : (
                                  <div style={{
                                      padding: '32px', textAlign: 'center',
                                      fontFamily: currentStyle === 'classic' ? 'Tahoma, Arial, sans-serif' : undefined,
                                      fontSize: currentStyle === 'classic' ? '11px' : undefined,
                                      color: '#888',
                                  }}>
                                      <i className="bi bi-collection-play" style={{ fontSize: 32, display: 'block', marginBottom: 8, opacity: 0.4 }}></i>
                                      No Production Runs yet. Click <strong>New Production Run</strong> to get started.
                                  </div>
                              )}
                          </div>
                      )}

                      {/* Manufacturing Orders tab content */}
                      {activeTab === 'manufacturing-orders' && viewMode === 'calendar' ? (
                          <div className="p-3"><CalendarView workOrders={manufacturingOrders} items={items} /></div>
                      ) : activeTab === 'manufacturing-orders' && (
                          <div className="table-responsive">
                              <table style={{
                                  width: '100%',
                                  borderCollapse: 'collapse',
                                  fontFamily: currentStyle === 'classic' ? 'Tahoma, Arial, sans-serif' : undefined,
                                  fontSize: currentStyle === 'classic' ? '11px' : undefined,
                                  background: currentStyle === 'classic' ? '#fff' : undefined,
                              }} className={currentStyle === 'classic' ? '' : 'table table-hover align-middle mb-0'}>
                                  <thead>
                                      <tr style={{
                                          background: currentStyle === 'classic'
                                              ? 'linear-gradient(to bottom,#fff 0%,#d4d0c8 100%)'
                                              : undefined,
                                          fontSize: currentStyle === 'classic' ? '10px' : '9pt',
                                      }} className={currentStyle === 'classic' ? '' : 'table-light'}>
                                          {[
                                              { label: 'MO Code',           align: 'left',   cls: 'ps-3' },
                                              { label: 'Product / Variant', align: 'left',   cls: '' },
                                              { label: 'Qty',               align: 'center', cls: '' },
                                              { label: 'Target Timeline',   align: 'left',   cls: '' },
                                              { label: 'Actual Progression',align: 'left',   cls: '' },
                                              { label: t('status'),         align: 'left',   cls: '' },
                                              { label: t('actions'),        align: 'right',  cls: 'pe-3 no-print' },
                                          ].map(({ label, align, cls }) => (
                                              <th key={label} className={cls} style={{
                                                  border: currentStyle === 'classic' ? '1px solid #808080' : undefined,
                                                  padding: currentStyle === 'classic' ? '3px 8px' : undefined,
                                                  textAlign: align as any,
                                                  color: '#000',
                                                  fontWeight: 'bold',
                                                  whiteSpace: 'nowrap',
                                              }}>{label}</th>
                                          ))}
                                      </tr>
                                  </thead>
                                  <tbody>
                                      {filteredWorkOrders.map((wo: any, rowIdx: number) => {
                                          const warning = getDueDateWarning(wo);
                                          const isExpanded = expandedRows[wo.id];
                                          const rowBg = currentStyle === 'classic'
                                              ? (isExpanded ? '#d6e4f7' : rowIdx % 2 === 0 ? '#fff' : '#f5f3ee')
                                              : undefined;
                                          const tdStyle: React.CSSProperties = currentStyle === 'classic' ? {
                                              border: '1px solid #c0bdb5',
                                              padding: '4px 8px',
                                              color: '#000',
                                              verticalAlign: 'middle',
                                          } : {};

                                          // XP-style status chip
                                          const statusChip = (status: string) => {
                                              if (currentStyle !== 'classic') {
                                                  return <span className={`badge ${getStatusBadge(status)} extra-small`}>{status}</span>;
                                              }
                                              const chipStyle: React.CSSProperties = {
                                                  display: 'inline-block', fontSize: '9px', fontWeight: 'bold',
                                                  padding: '1px 6px', borderRadius: 0, border: '1px solid',
                                                  fontFamily: 'Tahoma, Arial, sans-serif',
                                              };
                                              switch (status) {
                                                  case 'COMPLETED':  return <span style={{ ...chipStyle, background: '#2d7a2d', borderColor: '#1a5e1a', color: '#fff' }}>COMPLETED</span>;
                                                  case 'IN_PROGRESS': return <span style={{ ...chipStyle, background: '#0058e6', borderColor: '#003080', color: '#fff' }}>IN PROGRESS</span>;
                                                  case 'CANCELLED': return <span style={{ ...chipStyle, background: '#c00000', borderColor: '#800000', color: '#fff' }}>CANCELLED</span>;
                                                  default:          return <span style={{ ...chipStyle, background: '#d4d0c8', borderColor: '#808080', color: '#333' }}>PENDING</span>;
                                              }
                                          };

                                          // XP-style action button
                                          const xpBtn = (label: string, colorScheme: 'primary'|'success'|'danger'|'default', onClick: () => void, title?: string, iconCls?: string) => {
                                              if (currentStyle !== 'classic') return null; // rendered separately below
                                              const schemes: Record<string, React.CSSProperties> = {
                                                  primary: { background: 'linear-gradient(to bottom,#5a9ae0,#0058e6)', borderColor: '#003080 #001840 #001840 #003080', color: '#fff' },
                                                  success: { background: 'linear-gradient(to bottom,#5ec85e,#2d7a2d)', borderColor: '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#fff' },
                                                  danger:  { background: 'linear-gradient(to bottom,#fff,#d4d0c8)', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#c00000' },
                                                  default: { background: 'linear-gradient(to bottom,#fff,#d4d0c8)', borderColor: '#dfdfdf #808080 #808080 #dfdfdf', color: '#000' },
                                              };
                                              return (
                                                  <button key={label} onClick={onClick} title={title} style={{
                                                      fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '10px',
                                                      padding: '2px 7px', cursor: 'pointer', border: '1px solid',
                                                      ...schemes[colorScheme],
                                                  }}>
                                                      {iconCls && <i className={`${iconCls} me-1`}></i>}{label}
                                                  </button>
                                              );
                                          };

                                          return (
                                              <>
                                              <tr key={wo.id} style={{ background: rowBg, cursor: 'default' }}
                                                  className={currentStyle !== 'classic' && isExpanded ? 'table-primary bg-opacity-10' : ''}>

                                                  {/* MO Code */}
                                                  <td style={{ ...tdStyle, paddingLeft: currentStyle === 'classic' ? '10px' : undefined }}
                                                      className={currentStyle !== 'classic' ? 'ps-4 fw-bold font-monospace small' : ''}>
                                                      <span style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '11px', color: '#000' }}>{wo.code}</span>
                                                  </td>

                                                  {/* Product / Variant — click to expand */}
                                                  <td style={{ ...tdStyle, cursor: 'pointer' }} onClick={() => toggleRow(wo.id)}>
                                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                          <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} style={{ color: '#555', fontSize: '10px' }}></i>
                                                          <div>
                                                              <div style={{ fontWeight: 'bold', color: '#000', fontSize: currentStyle === 'classic' ? '11px' : '9pt' }}>
                                                                  {wo.item_name || getItemName(wo.item_id)}
                                                              </div>
                                                              {((wo.attribute_value_ids || []).length > 0 || wo.bom_size_id) && (
                                                                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 2 }}>
                                                                      {(wo.attribute_value_ids || []).map((id: string) => (
                                                                          <span key={id} style={{ fontSize: '8px', padding: '1px 5px', background: currentStyle === 'classic' ? '#dce8ff' : '#dbeafe', color: currentStyle === 'classic' ? '#003ea6' : '#1d4ed8', border: `1px solid ${currentStyle === 'classic' ? '#9ab0e0' : '#93c5fd'}`, borderRadius: currentStyle === 'classic' ? 0 : 3, fontWeight: 700 }}>
                                                                              {getAttributeValueName(id)}
                                                                          </span>
                                                                      ))}
                                                                      {wo.bom_size_id && (() => {
                                                                          const label = getBomSizeLabel(wo.bom_id, wo.bom_size_id);
                                                                          return label ? (
                                                                              <span style={{ fontSize: '8px', padding: '1px 5px', background: currentStyle === 'classic' ? '#e4f5e4' : '#dcfce7', color: currentStyle === 'classic' ? '#1a5e1a' : '#15803d', border: `1px solid ${currentStyle === 'classic' ? '#90c090' : '#86efac'}`, borderRadius: currentStyle === 'classic' ? 0 : 3, fontWeight: 700 }}>
                                                                                  <i className="bi bi-rulers me-1" style={{ fontSize: '7px' }}></i>{label}
                                                                              </span>
                                                                          ) : null;
                                                                      })()}
                                                                  </div>
                                                              )}
                                                              <div style={{ fontSize: '9px', color: '#555' }}>
                                                                  BOM: {getBOMCode(wo.bom_id)}
                                                                  {wo.sales_order_id && (
                                                                      <span style={{ marginLeft: '6px', fontWeight: 'bold', color: currentStyle === 'classic' ? '#0058e6' : undefined }} className={currentStyle !== 'classic' ? 'text-primary' : ''}>
                                                                          SO: {wo.sales_order_code || '—'}
                                                                      </span>
                                                                  )}
                                                                  {wo.child_mos && wo.child_mos.length > 0 && (
                                                                      currentStyle === 'classic'
                                                                          ? <span style={{ marginLeft: '6px', fontSize: '8px', background: '#fff3cd', border: '1px solid #b8860b', color: '#6b4e00', padding: '0 4px', fontWeight: 'bold' }}>NESTED x{wo.child_mos.length}</span>
                                                                          : <span className="ms-2 badge bg-info bg-opacity-10 text-info border border-info border-opacity-25" style={{fontSize: '0.65rem'}}>NESTED ({wo.child_mos.length})</span>
                                                                  )}
                                                              </div>
                                                          </div>
                                                      </div>
                                                  </td>

                                                  {/* Qty */}
                                                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 'bold', color: '#000' }}
                                                      className={currentStyle !== 'classic' ? 'text-center fw-bold' : ''}>
                                                      {wo.qty}
                                                  </td>

                                                  {/* Target Timeline */}
                                                  <td style={tdStyle}>
                                                      <div style={{ fontSize: currentStyle === 'classic' ? '10px' : undefined, display: 'flex', flexDirection: 'column', gap: '1px' }}
                                                           className={currentStyle !== 'classic' ? 'extra-small' : ''}>
                                                          <span style={{ color: '#000' }}>S: {formatDate(wo.target_start_date)}</span>
                                                          <span style={{ color: warning ? '#c00000' : '#000', fontWeight: warning ? 'bold' : undefined }}>
                                                              E: {formatDate(wo.target_end_date)}
                                                              {warning && <i className={`bi ${warning.icon} ms-1`} style={{ fontSize: '9px' }}></i>}
                                                          </span>
                                                      </div>
                                                  </td>

                                                  {/* Actual Progression */}
                                                  <td style={tdStyle}>
                                                      <div style={{ fontSize: currentStyle === 'classic' ? '10px' : undefined, display: 'flex', flexDirection: 'column', gap: '2px' }}
                                                           className={currentStyle !== 'classic' ? 'extra-small text-muted' : ''}>
                                                          <span style={{ color: '#555' }}>Start: {formatDateTime(wo.actual_start_date)}</span>
                                                          <span style={{ color: '#555' }}>End: {formatDateTime(wo.actual_end_date)}</span>
                                                          {(wo.qty_completed_total != null && wo.qty_completed_total > 0) && (() => {
                                                              const pct = Math.min(100, Math.round((wo.qty_completed_total / wo.qty) * 100));
                                                              return (
                                                                  <div style={{ marginTop: '2px' }}>
                                                                      <div className="progress" style={{ height: '5px', minWidth: '80px' }}>
                                                                          <div className={`progress-bar ${pct >= 100 ? 'bg-success' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                                                                      </div>
                                                                      <span style={{ fontSize: '9px', color: '#555' }}>{parseFloat(wo.qty_completed_total).toFixed(2)} / {wo.qty} ({pct}%)</span>
                                                                  </div>
                                                              );
                                                          })()}
                                                      </div>
                                                  </td>

                                                  {/* Status */}
                                                  <td style={tdStyle}>{statusChip(wo.status)}</td>

                                                  {/* Actions */}
                                                  <td style={{ ...tdStyle, textAlign: 'right' }} className="no-print">
                                                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px' }}>
                                                          {currentStyle === 'classic' ? (
                                                              <>
                                                                  {xpBtn('Print', 'default', () => handlePrintWO(wo), 'Print Manufacturing Order', 'bi bi-printer')}
                                                                  {wo.status === 'PENDING'     && xpBtn('Start',  'primary', () => onUpdateStatus(wo.id, 'IN_PROGRESS'))}
                                                                  {wo.status === 'IN_PROGRESS' && xpBtn('Log', 'success', () => setCompletionMO(wo))}
                                                                  {xpBtn('Del', 'danger', () => onDeleteMO(wo.id), 'Delete', 'bi bi-trash')}
                                                              </>
                                                          ) : (
                                                              <>
                                                                  <button className="btn btn-sm btn-link text-primary p-0" onClick={() => handlePrintWO(wo)} title="Print Manufacturing Order"><i className="bi bi-printer fs-5"></i></button>
                                                                  {wo.status === 'PENDING'     && <button className="btn btn-sm btn-primary py-0 px-2" style={{fontSize: '0.75rem'}} onClick={() => onUpdateStatus(wo.id, 'IN_PROGRESS')}>START</button>}
                                                                  {wo.status === 'IN_PROGRESS' && <button className="btn btn-sm btn-success py-0 px-2" style={{fontSize: '0.75rem'}} onClick={() => setCompletionMO(wo)}>LOG</button>}
                                                                  <button className="btn btn-sm btn-link text-danger p-0" onClick={() => onDeleteMO(wo.id)} title="Delete"><i className="bi bi-trash fs-5"></i></button>
                                                              </>
                                                          )}
                                                      </div>
                                                  </td>
                                              </tr>
                                              {isExpanded && (
                                                  <tr key={`${wo.id}-detail`}>
                                                      <td colSpan={7} className="p-0 border-0">
                                                          <WOExpandedPanel wo={wo} />
                                                      </td>
                                                  </tr>
                                              )}
                                              </>
                                          );
                                      })}
                                  </tbody>
                              </table>
                          </div>
                      )}
                  </div>
              </div>
          </div>

          {isPRModalOpen && (
              <ProductionRunModal
                  bom={prModalBom || undefined}
                  boms={boms}
                  locations={locations}
                  onSave={onCreateProductionRun}
                  onClose={() => { setIsPRModalOpen(false); setPrModalBom(null); setPrModalInitialSizes(undefined); setPrModalTotalQty(undefined); setPrModalSalesOrderId(undefined); }}
                  initialSizes={prModalInitialSizes}
                  initialTotalQty={prModalTotalQty}
                  salesOrderId={prModalSalesOrderId}
              />
          )}

          {completionMO && (
              <MOCompletionModal
                  mo={completionMO}
                  onClose={() => setCompletionMO(null)}
                  onSaved={(updated) => {
                      setCompletionMO(null);
                      fetchData('work-orders');
                  }}
              />
          )}
      </div>
  );
}
