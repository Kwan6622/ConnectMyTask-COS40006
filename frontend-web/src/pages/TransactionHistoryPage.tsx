import { useEffect, useState } from 'react';
import { moneyStatusClasses } from '../utils/statusColors';
import { Link } from 'react-router-dom';
import { BanknotesIcon, CheckCircleIcon, ClockIcon, DocumentTextIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { api } from '../services/api';
import type { PaymentTransaction } from '../types';
import { formatVnd } from '../utils';

function receiptTime(transaction: PaymentTransaction): { label: string; value: string } {
  const isPaid = transaction.status === 'SUCCESS' && (transaction.type === 'ESCROW_DEPOSIT' || transaction.type === 'DIRECT_PAYMENT');
  const isRefund = transaction.type === 'ESCROW_REFUND' && Boolean(transaction.paidAt);
  const timestamp = (isPaid || isRefund || transaction.type === 'ESCROW_RELEASE') && transaction.paidAt
    ? transaction.paidAt : transaction.createdAt;
  const label = isPaid && transaction.paidAt ? 'Paid at'
    : isPaid ? 'Created at · payment time unavailable'
      : isRefund ? 'Refunded at'
        : transaction.type === 'ESCROW_RELEASE' ? 'Recorded at' : 'Created at';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return { label, value: 'Not available' };
  const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
  return { label, value: `${day} · ${time}` };
}

function statusLabel(value?: string): string {
  return String(value || 'UNKNOWN').replaceAll('_', ' ');
}

function transactionStatusLabel(transaction: PaymentTransaction): string {
  return transaction.type === 'ESCROW_RELEASE' && transaction.settlementMode === 'SIMULATED_DEMO'
    ? 'DEMO PAYOUT · NOT TRANSFERRED'
    : statusLabel(transaction.status);
}

function transactionAmount(transaction: PaymentTransaction): number {
  return transaction.type === 'ESCROW_RELEASE'
    ? Number(transaction.providerPayoutAmount ?? transaction.amount)
    : Number(transaction.totalAmount ?? transaction.amount);
}

function transactionType(transaction: PaymentTransaction): string {
  return {
    ESCROW_DEPOSIT: 'Escrow Deposit',
    ESCROW_RELEASE: 'Escrow Release',
    ESCROW_REFUND: 'Escrow Refund',
    DIRECT_PAYMENT: 'Direct Payment',
  }[transaction.type];
}

function amountLabel(transaction: PaymentTransaction): string {
  if (transaction.type === 'ESCROW_RELEASE') return 'Provider payout recorded';
  if (transaction.type === 'ESCROW_REFUND') return 'Refund amount';
  return transaction.status === 'SUCCESS' ? 'Amount paid' : 'Payment amount';
}

function statusTone(status?: string): string {
  return moneyStatusClasses(status);
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
      setSelected((current) => items.find((item: PaymentTransaction) => String(item.id) === String(current?.id)) || items[0] || null);
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
                  aria-pressed={String(selected?.id) === String(transaction.id)}
                  className={`w-full rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:border-blue-300 ${String(selected?.id) === String(transaction.id) ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200'}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-blue-600">{transactionType(transaction)} · {transaction.reference || `CMT-${transaction.id}`}</p>
                      <p className="mt-1 font-semibold text-slate-900">{transaction.task?.title || `Task #${transaction.taskId}`}</p>
                      <p className="mt-1 text-xs text-slate-500">{receiptTime(transaction).label}: {receiptTime(transaction).value}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-slate-900">{formatVnd(transactionAmount(transaction))}</p>
                      <p className={`mt-2 inline-block rounded-full border px-2.5 py-1 text-[11px] font-semibold ${transaction.settlementMode === 'SIMULATED_DEMO' ? statusTone('PENDING') : statusTone(transaction.status)}`}>{transactionStatusLabel(transaction)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <Card className="h-fit lg:sticky lg:top-24">
              {selected ? (
                <div className="space-y-6 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><DocumentTextIcon className="h-6 w-6" /></div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transaction receipt</p>
                        <h2 className="text-lg font-bold text-slate-900">{transactionType(selected)}</h2>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${statusTone(selected.status)}`}>
                      {selected.status === 'SUCCESS' ? <CheckCircleIcon className="h-4 w-4" /> : selected.status === 'PENDING' ? <ClockIcon className="h-4 w-4" /> : <ExclamationCircleIcon className="h-4 w-4" />}
                      {statusLabel(selected.status)}
                    </span>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white px-5 py-6">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{amountLabel(selected)}</p>
                    <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{formatVnd(transactionAmount(selected))}</p>
                    <p className="mt-2 text-xs text-slate-600">{receiptTime(selected).label}: {receiptTime(selected).value}</p>
                  </div>

                  {selected.type === 'ESCROW_RELEASE' && selected.settlementMode === 'SIMULATED_DEMO' && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 font-semibold text-amber-800">
                      DEMO PAYOUT · NOT TRANSFERRED — no Stripe Connect transfer was sent.
                    </div>
                  )}

                  <section className="space-y-1">
                    <h3 className="mb-3 font-semibold text-slate-900">Transaction</h3>
                    <Detail label="Reference / ID" value={selected.reference || `CMT-${selected.id}`} />
                    <Detail label="Task" value={selected.task?.title || `Task #${selected.taskId}`} />
                    <Detail label="Type" value={transactionType(selected)} />
                    {selected.task?.originalBudget != null && <Detail label="Original budget" value={formatVnd(selected.task.originalBudget)} />}
                  </section>

                  <section className="space-y-1 border-t border-dashed border-slate-200 pt-5">
                    <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><BanknotesIcon className="h-5 w-5 text-blue-600" /> Payment details</h3>
                    <Detail label="Payment method" value={selected.method === 'STRIPE' ? 'Stripe' : selected.method} />
                    {selected.card && <Detail label="Card" value={`${selected.card.brand.toUpperCase()} •••• ${selected.card.last4}`} />}
                    {(selected.type === 'ESCROW_DEPOSIT' || selected.type === 'ESCROW_RELEASE') && <Detail label="Accepted bid" value={formatVnd(Number(selected.agreedPrice ?? selected.totalAmount ?? selected.amount))} />}
                    {(selected.type === 'ESCROW_DEPOSIT' || selected.type === 'ESCROW_RELEASE') && <Detail label="Platform fee" value={formatVnd(Number(selected.platformFeeAmount ?? 0))} />}
                    {(selected.type === 'ESCROW_DEPOSIT' || selected.type === 'ESCROW_RELEASE') && selected.providerPayoutAmount != null && <Detail label={selected.type === 'ESCROW_RELEASE' ? 'Provider payout (demo)' : 'Expected provider payout'} value={formatVnd(Number(selected.providerPayoutAmount))} />}
                    <Detail label={selected.type === 'ESCROW_REFUND' ? 'Refund amount' : 'Total'} value={formatVnd(Number(selected.totalAmount ?? selected.amount))} />
                  </section>

                  <section className="space-y-3 border-t border-dashed border-slate-200 pt-5">
                    <h3 className="font-semibold text-slate-900">Status</h3>
                    <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Payment</span><span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(selected.status)}`}>{statusLabel(selected.status)}</span></div>
                    <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Escrow</span><span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(selected.escrowStatus || selected.task?.escrowStatus)}`}>{statusLabel(selected.escrowStatus || selected.task?.escrowStatus)}</span></div>
                    {selected.refund && <Detail label="Refund" value={`${formatVnd(selected.refund.amount)} · ${statusLabel(selected.refund.status)}`} />}
                  </section>

                  <Link className="inline-flex items-center gap-2 border-t border-slate-100 pt-5 font-semibold text-blue-600 hover:text-blue-700" to={`/tasks/${selected.taskId}`}>
                    Open task <span aria-hidden="true">→</span>
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-slate-600">Select a transaction to view its receipt.</p>
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
    <div className="flex justify-between gap-4 py-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-[65%] break-words text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}
