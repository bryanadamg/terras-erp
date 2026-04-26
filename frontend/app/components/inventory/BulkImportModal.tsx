import { useState, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import ModalWrapper from '../shared/ModalWrapper';

interface BulkImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImport: (file: File) => Promise<any>;
    onDownloadTemplate: () => void;
    title: string;
}

export default function BulkImportModal({ isOpen, onClose, onImport, onDownloadTemplate, title }: BulkImportModalProps) {
    const { t } = useLanguage();
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [results, setResults] = useState<any>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { uiStyle: currentStyle } = useTheme();
    const classic = currentStyle === 'classic';

    // ── XP style constants ────────────────────────────────────────────────────
    const xpBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontSize: '11px',
        padding: '2px 10px',
        cursor: 'pointer',
        background: 'linear-gradient(to bottom, #ffffff 0%, #d4d0c8 100%)',
        border: '1px solid',
        borderColor: '#dfdfdf #808080 #808080 #dfdfdf',
        color: '#000000',
        borderRadius: 0,
        ...extra,
    });

    const xpInput: React.CSSProperties = {
        fontFamily: 'Tahoma, Arial, sans-serif',
        fontSize: '11px',
        border: '1px solid #7f9db9',
        boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.1)',
        padding: '1px 6px',
        background: '#ffffff',
        color: '#000000',
        height: '20px',
        outline: 'none',
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setResults(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        try {
            const res = await onImport(file);
            setResults(res);
        } catch (error) {
            setResults({ status: 'error', errors: ['Upload failed'] });
        } finally {
            setUploading(false);
        }
    };

    const reset = () => {
        setFile(null);
        setResults(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <ModalWrapper
            isOpen={isOpen}
            onClose={onClose}
            title={<><i className="bi bi-file-earmark-spreadsheet me-2"></i>{title}</>}
            variant="primary"
            size="md"
            footer={
                results ? (
                    <button
                        style={classic ? xpBtn({ background: 'linear-gradient(to bottom, #316ac5, #1a4a8a)', borderColor: '#1a3a7a #0a1a4a #0a1a4a #1a3a7a', color: '#ffffff', fontWeight: 'bold' }) : undefined}
                        className={classic ? '' : 'btn btn-primary'}
                        onClick={() => { reset(); onClose(); }}
                    >Close</button>
                ) : (
                    <>
                        <button
                            style={classic ? xpBtn() : undefined}
                            className={classic ? '' : 'btn btn-secondary'}
                            onClick={onClose}
                        >Cancel</button>
                        <button
                            style={classic ? xpBtn({ background: !file || uploading ? 'linear-gradient(to bottom, #d4d0c8, #b0ac9c)' : 'linear-gradient(to bottom, #5ec85e, #2d7a2d)', borderColor: !file || uploading ? '#a0988c #707068 #707068 #a0988c' : '#1a5e1a #0a3e0a #0a3e0a #1a5e1a', color: '#ffffff', fontWeight: 'bold' }) : undefined}
                            className={classic ? '' : 'btn btn-success'}
                            onClick={handleUpload}
                            disabled={!file || uploading}
                        >
                            {uploading ? (
                                <><span className="spinner-border spinner-border-sm" style={classic ? { width: 10, height: 10, marginRight: 4 } : { marginRight: 4 }}></span>Importing…</>
                            ) : 'Start Import'}
                        </button>
                    </>
                )
            }
        >
            {!results ? (
                <>
                    <p
                        style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#444', marginBottom: 10 } : undefined}
                        className={classic ? '' : 'text-muted small'}
                    >
                        Upload a CSV file to bulk create items. Please use the provided template to ensure correct formatting.
                    </p>
                    <div style={classic ? { marginBottom: 12 } : undefined} className={classic ? '' : 'd-flex justify-content-between mb-4'}>
                        <button
                            style={classic ? xpBtn() : undefined}
                            className={classic ? '' : 'btn btn-sm btn-outline-primary'}
                            onClick={onDownloadTemplate}
                        >
                            <i className={classic ? 'bi bi-download' : 'bi bi-download me-1'} style={classic ? { marginRight: 4 } : undefined}></i>Download Template
                        </button>
                    </div>
                    <div style={classic ? { marginBottom: 8 } : undefined} className={classic ? '' : 'mb-3'}>
                        <label
                            style={classic ? { fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#000', display: 'block', marginBottom: 2 } : undefined}
                            className={classic ? '' : 'form-label small fw-bold'}
                        >Select File</label>
                        {classic ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <label style={xpBtn({ padding: '2px 8px', cursor: 'pointer' })}>
                                    <i className="bi bi-folder2-open" style={{ marginRight: 4 }}></i>Browse…
                                    <input
                                        type="file"
                                        hidden
                                        accept=".csv"
                                        onChange={handleFileChange}
                                        ref={fileInputRef}
                                    />
                                </label>
                                <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: file ? '#000' : '#888', background: '#ffffff', border: '1px solid #7f9db9', padding: '1px 8px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, height: 20, display: 'flex', alignItems: 'center' }}>
                                    {file ? file.name : 'No file selected'}
                                </span>
                            </div>
                        ) : (
                            <input
                                type="file"
                                className="form-control"
                                accept=".csv"
                                onChange={handleFileChange}
                                ref={fileInputRef}
                            />
                        )}
                    </div>
                </>
            ) : (
                <div style={classic ? { textAlign: 'center' } : undefined} className={classic ? '' : 'text-center'}>
                    {results.status === 'success' ? (
                        classic ? (
                            <div style={{ textAlign: 'center', padding: '12px 0' }}>
                                <i className="bi bi-check-circle-fill" style={{ fontSize: 32, color: '#2e7d32', display: 'block', marginBottom: 8 }}></i>
                                <div style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '13px', fontWeight: 'bold', color: '#2e7d32', marginBottom: 4 }}>Import Successful!</div>
                                <div style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#444' }}>{results.imported} items imported.</div>
                            </div>
                        ) : (
                            <div className="text-success mb-3">
                                <i className="bi bi-check-circle-fill fs-1"></i>
                                <h5 className="mt-2">Import Successful!</h5>
                                <p>{results.imported} items imported.</p>
                            </div>
                        )
                    ) : (
                        classic ? (
                            <div style={{ textAlign: 'left' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                    <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: 18, color: '#c77800' }}></i>
                                    <span style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '13px', fontWeight: 'bold', color: '#4a3000' }}>Partial Success</span>
                                </div>
                                <div style={{ fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#555', marginBottom: 6 }}>
                                    Imported: {results.imported}
                                </div>
                                <div style={{ background: '#fffbe6', border: '1px solid #c77800', borderLeft: '4px solid #c77800', padding: '6px 10px', maxHeight: 150, overflowY: 'auto' as const }}>
                                    <ul style={{ margin: 0, paddingLeft: 16, fontFamily: 'Tahoma, Arial, sans-serif', fontSize: '11px', color: '#4a3000' }}>
                                        {results.errors.map((err: string, i: number) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        ) : (
                            <div className="text-start">
                                <div className="d-flex align-items-center text-warning mb-2">
                                    <i className="bi bi-exclamation-triangle-fill fs-4 me-2"></i>
                                    <h5 className="mb-0">Partial Success</h5>
                                </div>
                                <p className="small text-muted">Imported: {results.imported}</p>
                                <div className="alert alert-warning small" style={{maxHeight: '150px', overflowY: 'auto'}}>
                                    <ul className="mb-0 ps-3">
                                        {results.errors.map((err: string, i: number) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )
                    )}
                </div>
            )}
        </ModalWrapper>
    );
}
