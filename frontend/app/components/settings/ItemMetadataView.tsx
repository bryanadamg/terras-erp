'use client';

import { useRememberedTab } from '../../hooks/useRememberedTab';
import { useUser } from '../../context/UserContext';
import CategoriesView from './CategoriesView';
import UOMLibraryView from './UOMLibraryView';
import AttributesLibraryView from './AttributesLibraryView';
import { Tabs } from '../shared/Tabs';
import { viewShellStyle, PageTitleBar } from '../shared/shellTheme';

interface Props {
    categories: any[];
    uoms: any[];
    attributes: any[];
    onCreateCategory: (name: string, parentId?: string) => Promise<any>;
    onDeleteCategory: (id: string) => Promise<void>;
    onRenameCategory: (id: string, name: string) => Promise<void>;
    onCreateUOM: (name: string) => Promise<Response>;
    onDeleteUOM: (id: string) => void;
    onSaveUOMFactor: (fromUomId: string, toUomId: string, value: number) => void;
    onDeleteUOMFactor: (uomId: string, factorId: string) => void;
    onCreateAttribute: (p: any) => Promise<Response>;
    onUpdateAttribute: (id: string, name: string) => void;
    onDeleteAttribute: (id: string) => void;
    onAddValue: (attributeId: string, value: string) => void;
    onUpdateValue: (valueId: string, value: string) => void;
    onDeleteValue: (valueId: string) => void;
}

type Tab = 'attributes' | 'categories' | 'uom';

// Table-container + tabs shell (matches Color Library / Work Order table pattern) — one
// window hosting the three item-metadata surfaces (Attributes, Categories, UOM) instead
// of three separately-styled stacked cards. Each tab's own view owns its table/toolbar;
// this shell only owns the title bar + tab strip.
export default function ItemMetadataView({
    categories, uoms, attributes,
    onCreateCategory, onDeleteCategory, onRenameCategory,
    onCreateUOM, onDeleteUOM, onSaveUOMFactor, onDeleteUOMFactor,
    onCreateAttribute, onUpdateAttribute, onDeleteAttribute,
    onAddValue, onUpdateValue, onDeleteValue,
}: Props) {
    const { hasPermission } = useUser();
    const canFor = (resource: string) => ({
        create: hasPermission(`${resource}.create`),
        edit: hasPermission(`${resource}.edit`),
        delete: hasPermission(`${resource}.delete`),
    });

    // Each tab opens on its own .view code; the page itself opens on any of them.
    const allTabs: { key: Tab; label: string; perm: string }[] = [
        { key: 'attributes', label: 'Attributes', perm: 'attribute.view' },
        { key: 'categories', label: 'Categories', perm: 'category.view' },
        { key: 'uom', label: 'Units of Measure', perm: 'uom.view' },
    ];
    const visibleTabs = allTabs.filter(t => hasPermission(t.perm));
    const visibleKeys = visibleTabs.map(t => t.key);
    const [rememberedTab, setTab] = useRememberedTab<Tab>('item-metadata', visibleKeys[0] ?? 'attributes', visibleKeys);
    const tab = visibleKeys.includes(rememberedTab) ? rememberedTab : visibleKeys[0];

    return (
        <div className="fade-in" style={viewShellStyle()}>

            <PageTitleBar icon="bi-tag" title="Attributes" />

            <Tabs
                activeKey={tab}
                onChange={k => setTab(k as Tab)}
                tabs={visibleTabs.map(({ key, label }) => ({ key, label }))}
            />

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {tab === 'attributes' && (
                    <AttributesLibraryView
                        attributes={attributes || []}
                        can={canFor('attribute')}
                        onCreateAttribute={onCreateAttribute}
                        onUpdateAttribute={onUpdateAttribute}
                        onDeleteAttribute={onDeleteAttribute}
                        onAddValue={onAddValue}
                        onUpdateValue={onUpdateValue}
                        onDeleteValue={onDeleteValue}
                    />
                )}
                {tab === 'categories' && (
                    <CategoriesView
                        categories={categories || []}
                        onCreateCategory={onCreateCategory}
                        onDeleteCategory={onDeleteCategory}
                        onRenameCategory={onRenameCategory}
                    />
                )}
                {tab === 'uom' && (
                    <UOMLibraryView
                        uoms={uoms || []}
                        can={canFor('uom')}
                        onCreateUOM={onCreateUOM}
                        onDeleteUOM={onDeleteUOM}
                        onSaveUOMFactor={onSaveUOMFactor}
                        onDeleteUOMFactor={onDeleteUOMFactor}
                    />
                )}
            </div>
        </div>
    );
}
