import { useData } from '../../context/DataContext';

export default function PrintHeader({ title }: { title: string }) {
    const { companyProfile } = useData();
    const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api').replace('/api', '');

    return (
        <div className="d-none d-print-block mb-4">
            <div className="row align-items-center">
                <div className="col-8">
                    {companyProfile?.logo_url ? (
                        <img 
                            src={`${API_BASE}${companyProfile.logo_url}`} 
                            alt="Logo" 
                            style={{ maxHeight: '80px', maxWidth: '250px', objectFit: 'contain' }} 
                            className="mb-2"
                        />
                    ) : (
                        <h2 className="text-primary fw-bold mb-1">{companyProfile?.name || 'Terras ERP'}</h2>
                    )}
                    <div className="small text-muted">
                        {companyProfile?.address && <div className="mb-0">{companyProfile.address}</div>}
                        <div className="mb-0">
                            {companyProfile?.phone && <span className="me-3"><i className="bi bi-telephone me-1"></i>{companyProfile.phone}</span>}
                            {companyProfile?.email && <span className="me-3"><i className="bi bi-envelope me-1"></i>{companyProfile.email}</span>}
                        </div>
                        {companyProfile?.website && <div className="mb-0"><i className="bi bi-globe me-1"></i>{companyProfile.website}</div>}
                        {companyProfile?.tax_id && <div className="mb-0 fw-bold mt-1">Tax ID: {companyProfile.tax_id}</div>}
                    </div>
                </div>
                <div className="col-4 text-end">
                    <h1 className="h3 text-uppercase fw-bold text-secondary">{title}</h1>
                    <div className="small text-muted">Printed on: {new Date().toLocaleString()}</div>
                </div>
            </div>
            <hr className="border-secondary opacity-25" />
        </div>
    );
}
