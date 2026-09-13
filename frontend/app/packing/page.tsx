'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import PackingOrderView from '../components/packing/PackingOrderView';

export default function PackingPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const [initialCreateState, setInitialCreateState] = useState<any>(null);
    const consumedRef = useRef<string | null>(null);

    useEffect(() => {
        const itemId = searchParams.get('item_id');
        const token = `${itemId}:${searchParams.get('source_location_id')}`;
        if (searchParams.get('action') === 'create_packing_order' && itemId && token !== consumedRef.current) {
            consumedRef.current = token;
            setInitialCreateState({
                item_id: itemId,
                source_location_id: searchParams.get('source_location_id') || '',
                sales_order_id: searchParams.get('sales_order_id') || '',
                sales_order_line_id: searchParams.get('sales_order_line_id') || '',
                qty_target: searchParams.get('qty_target') || '',
                bom_size_id: searchParams.get('bom_size_id') || '',
                size_label: searchParams.get('size_label') || '',
                color_id: searchParams.get('color_id') || '',
                combo_value_id: searchParams.get('combo_value_id') || '',
            });
            router.replace('/packing');
        }
    }, [searchParams, router]);

    const handleClearInitialState = useCallback(() => setInitialCreateState(null), []);

    return (
        <PackingOrderView
            initialCreateState={initialCreateState}
            onClearInitialState={handleClearInitialState}
        />
    );
}
