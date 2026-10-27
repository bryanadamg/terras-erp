// Save a fetched file (e.g. an .xlsx export) under the server's Content-Disposition
// name, falling back to `fallbackName` when the header is missing.
export async function saveResponse(res: Response, fallbackName: string): Promise<void> {
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || fallbackName;
    a.click();
    URL.revokeObjectURL(url);
}
