import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { Button } from '#/client/components/button';
import { Modal } from '#/client/components/modal';
import { useI18n } from '#/client/i18n';

export interface TableDialogProps {
  onSubmit: (rows: number, columns: number) => void;
  onDismiss: () => void;
}

const MAX_COLUMNS = 12;
const MAX_ROWS = 50;

function validSize(value: string, max: number): number | null {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 1 || number > max) {
    return null;
  }
  return number;
}

/**
 * 插入表格弹窗：按 Typora 的方式输入行数和列数，生成 Inky 的行列网格。
 */
export function TableDialog({ onSubmit, onDismiss }: TableDialogProps) {
  const { t } = useI18n();
  const [columns, setColumns] = useState('3');
  const [rows, setRows] = useState('3');
  const columnsRef = useRef<HTMLInputElement>(null);
  const columnCount = validSize(columns, MAX_COLUMNS);
  const rowCount = validSize(rows, MAX_ROWS);
  const canSubmit = columnCount !== null && rowCount !== null;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      columnsRef.current?.focus();
      columnsRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = () => {
    if (columnCount === null || rowCount === null) {
      return;
    }
    onSubmit(rowCount, columnCount);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Modal
      title={t('compose.insertTable')}
      onDismiss={onDismiss}
      footer={
        <>
          <Button onClick={onDismiss}>{t('ui.cancel')}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {t('compose.insert')}
          </Button>
        </>
      }
    >
      <div className="inky-table-dialog">
        <label className="inky-table-field">
          <span>{t('compose.tableColumns')}</span>
          <input
            ref={columnsRef}
            type="number"
            min={1}
            max={MAX_COLUMNS}
            step={1}
            value={columns}
            onChange={event => setColumns(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t('compose.tableColumns')}
          />
        </label>
        <label className="inky-table-field">
          <span>{t('compose.tableRows')}</span>
          <input
            type="number"
            min={1}
            max={MAX_ROWS}
            step={1}
            value={rows}
            onChange={event => setRows(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t('compose.tableRows')}
          />
        </label>
      </div>
    </Modal>
  );
}
