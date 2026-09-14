'use client';

import { useState } from 'react';
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
    const { hasPermission, hasAnyPermission } = useUser();
    const canManage = hasAnyPermission(
        'attribute.create', 'attribute.edit', 'attribute.delete',
        'category.create', 'category.edit', 'category.delete',
        'uom.create', 'uom.edit', 'uom.delete',
    );

    const [tab, setTab] = useState<Tab>('attributes');

    return (
        <div className="fade-in" style={viewShellStyle()}>

            <PageTitleBar icon="bi-tag" title="Attributes" />

            <Tabs
                classic
                activeKey={tab}
                onChange={k => setTab(k as Tab)}
                tabs={[
                    { key: 'attributes', label: 'Attributes' },
                    { key: 'categories', label: 'Categories' },
                    { key: 'uom', label: 'Units of Measure' },
                ]}
            />

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {tab === 'attributes' && (
                    <AttributesLibraryView
                        attributes={attributes || []}
                        canManage={canManage}
                        onCreateAttribute={onCreateAttribute}
                        onUpdateAttribute={onUpdateAttribute}
                        onDeleteAttribute={onDeleteAttribute}
                        onAddValue={onAddValue}
                        onUpdateValue={onUpdateValue}
                        onDeleteValue={onDeleteValue}
                    />
                )}
                {tab === 'categories' && (
                    <div style={{ flex: 1, overflow: 'auto', padding: 12, background: '#fff' }}>
                        <CategoriesView
                            categories={categories || []}
                            onCreateCategory={onCreateCategory}
                            onDeleteCategory={onDeleteCategory}
                            onRenameCategory={onRenameCategory}
                        />
                    </div>
                )}
                {tab === 'uom' && (
                    <UOMLibraryView
                        uoms={uoms || []}
                        canManage={canManage}
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
