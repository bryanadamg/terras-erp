'use client';

import StockOnHandView from '../components/stock/StockOnHandView';
import MobileStockView from '../components/mobile/StockView';
import { useData } from '../context/DataContext';
import { useItemSearch } from '../components/shared/useEntitySearch';
import { useIsMobile } from '../hooks/useIsMobile';
import { API_BASE } from '../components/shared/apiBase';

export default function StockPage() {
    // No `stockBalance` in the desktop grid on purpose: it's server-paginated
    // against /stock/balance/paginated. DataContext's `stockBalance` stays the
    // unpaginated plant-wide lookup feed (manufacturing material availability,
    // dashboards, and the mobile browse view below).
    const { items, locations, attributes, categories, stockBalance, fetchData, authFetch } = useData();
    const isMobile = useIsMobile();

    // Item picker source for the New Entry modal — server typeahead, so it reaches
    // past the 50-row page DataContext holds.
    const { results: selectItems, onSearch: handleItemSearch } = useItemSearch({ seed: items });

    if (isMobile) {
        return <MobileStockView items={items} locations={locations} stockBalance={stockBalance} />;
    }

    return (
        <StockOnHandView
            locations={locations}
            attributes={attributes}
            categories={categories}
            items={selectItems}
            onSearchItems={handleItemSearch}
            onRefresh={fetchData}
            authFetch={authFetch}
            apiBase={API_BASE}
        />
    );
}
