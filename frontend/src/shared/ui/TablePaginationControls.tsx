import { Form, Pagination, Stack } from "react-bootstrap";
import { useEffect, useMemo, useState } from "react";

const OPTIONS = [10, 25, 50] as const;

type Props = {
  tableId: string;
  page: number;
  totalRows: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: 10 | 25 | 50) => void;
};

export function useStoredPageSize(tableId: string, fallback: 10 | 25 | 50): [10 | 25 | 50, (next: 10 | 25 | 50) => void] {
  const key = `table.pageSize.${tableId}`;
  const [value, setValue] = useState<10 | 25 | 50>(() => {
    const raw = window.localStorage.getItem(key);
    const parsed = Number(raw);
    return parsed === 25 || parsed === 50 ? parsed : fallback;
  });
  useEffect(() => {
    window.localStorage.setItem(key, String(value));
  }, [key, value]);
  return [value, setValue];
}

export function TablePaginationControls({ tableId, page, totalRows, pageSize, onPageChange, onPageSizeChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(totalRows / Math.max(1, pageSize)));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const [start, end] = useMemo(() => {
    if (totalRows <= 0) return [0, 0];
    const s = (clamped - 1) * pageSize + 1;
    return [s, Math.min(totalRows, s + pageSize - 1)];
  }, [clamped, pageSize, totalRows]);

  return (
    <Stack direction="horizontal" className="justify-content-between align-items-center gap-3 flex-wrap mt-2">
      <small className="text-muted">Rows {start}-{end} / {totalRows}</small>
      <Stack direction="horizontal" className="gap-3 align-items-center">
        <Stack direction="horizontal" className="align-items-center gap-2">
          <span>Page size</span>
          <Form.Select
            size="sm"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as 10 | 25 | 50)}
            style={{ width: 92 }}
            aria-label={`${tableId} rows per page`}
          >
            {OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </Form.Select>
        </Stack>
        <Pagination size="sm" className="mb-0">
          <Pagination.First onClick={() => onPageChange(1)} disabled={clamped <= 1} />
          <Pagination.Prev onClick={() => onPageChange(Math.max(1, clamped - 1))} disabled={clamped <= 1} />
          <Pagination.Item active>{clamped}</Pagination.Item>
          <Pagination.Next onClick={() => onPageChange(Math.min(totalPages, clamped + 1))} disabled={clamped >= totalPages} />
          <Pagination.Last onClick={() => onPageChange(totalPages)} disabled={clamped >= totalPages} />
        </Pagination>
      </Stack>
    </Stack>
  );
}
