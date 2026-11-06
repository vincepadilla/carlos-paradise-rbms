export default function AdminPagination({ page, lastPage, total, onChange }: {
    page: number;
    lastPage: number;
    total: number;
    onChange: (page: number) => void;
}) {
    return <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="admin-button" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
        <span>Page {page} of {lastPage} · {total} records</span>
        <button type="button" className="admin-button" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>Next</button>
    </nav>;
}
