import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { api } from '../services/api';
import type { PaymentTransaction } from '../types';
import { formatVnd } from '../utils';

function formatDateTime(value?: string | null): string {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString();
}

function statusLabel(value?: string): string {
  return String(value || 'UNKNOWN').replaceAll('_', ' ');
}

export function TransactionHistoryPage() {
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [selected, setSelected] = useState<PaymentTransaction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTransactions = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await api.payment.getMine();
      const items = Array.isArray(response.data) ? response.data : [];
      setTransactions(items);
      setSelected((current) => current
        ? items.find((item: PaymentTransaction) => String(item.id) === String(current.id)) || null
        : null);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Unable to load transaction history.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTransactions();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="container mx-auto max-w-6xl px-4">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Requester payments</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-900">Transaction History</h1>
            <p className="mt-2 text-sm text-slate-600">Newest transactions are shown first.</p>
          </div>
          <Button variant="outline" onClick={() => void loadTransactions()} disabled={isLoading}>
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {error ? (
          <Card className="border-red-200 p-5 text-red-700">
            <p>{error}</p>
            <Button className="mt-3" variant="outline" onClick={() => void loadTransactions()}>Retry</Button>
          </Card>
        ) : isLoading ? (
          <Card className="p-8 text-center text-slate-600">Loading transactions...</Card>
        ) : transactions.length === 0 ? (
          <Card className="p-8 text-center text-slate-600">No requester transactions yet.</Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="space-y-3">
              {transactions.map((transaction) => (
                <button
                  key={String(transaction.id)}
                  type="button"
                  onClick={() => setSelected(transaction)}
                  className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-blue-600">{transaction.reference || `CMT-${transaction.id}`}</p>
                      <p className="mt-1 font-semibold text-slate-900">{transaction.task?.title || `Task #${transaction.taskId}`}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatDateTime(transaction.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-slate-900">{formatVnd(Number(transaction.totalAmount ?? transaction.amount))}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-600">{statusLabel(transaction.status)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <Card className="h-fit p-5 lg:sticky lg:top-24">
              {selected ? (
                <div className="space-y-3 text-sm">
                  <h2 className="text-lg font-bold text-slate-900">Transaction detail</h2>
                  <Detail label="Reference" value={selected.reference || `CMT-${selected.id}`} />
                  <Detail label="Task" value={selected.task?.title || `Task #${selected.taskId}`} />
                  <Detail label="Date/time" value={formatDateTime(selected.paidAt || selected.createdAt)} />
                  {selected.task?.originalBudget != null ? <Detail label="Original budget" value={formatVnd(selected.task.originalBudget)} /> : null}
                  <Detail label="Accepted bid" value={formatVnd(Number(selected.agreedPrice ?? selected.amount))} />
                  <Detail label="Platform fee" value={formatVnd(Number(selected.platformFeeAmount || 0))} />
                  <Detail label="Total" value={formatVnd(Number(selected.totalAmount ?? selected.amount))} />
                  <Detail label="Payment status" value={statusLabel(selected.status)} />
                  <Detail label="Escrow status" value={statusLabel(selected.escrowStatus || selected.task?.escrowStatus)} />
                  {selected.card ? <Detail label="Card" value={`${selected.card.brand.toUpperCase()} •••• ${selected.card.last4}`} /> : null}
                  {selected.refund ? <Detail label="Refund" value={`${formatVnd(selected.refund.amount)} · ${statusLabel(selected.refund.status)}`} /> : null}
                  <Link className="inline-block pt-2 font-semibold text-blue-600 hover:text-blue-700" to={`/tasks/${selected.taskId}`}>
                    Open task
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-slate-600">Select a transaction to view details.</p>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-900">{value}</span>
    </div>
  );
}
