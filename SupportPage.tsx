import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../stores/auth.store';
import { uploadImageToCloudinary } from '../utils/cloudinaryUpload';

type Ticket = { id: number; subject: string; description: string; category: string; status: string; priority: string; evidenceUrls: string[]; createdAt: string; requester?: { name: string }; taskId?: number; paymentId?: number };
type Message = { id: number; body: string; evidenceUrls: string[]; createdAt: string; sender: { name: string; role: string } };
type Activity = { id: number; action: string; fromValue?: string; toValue?: string; createdAt: string; actor: { name: string } };
const categories = ['TASK', 'BIDDING', 'PAYMENT', 'ACCOUNT', 'TECHNICAL', 'OTHER'];
const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const errorText = (err: unknown) => (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message || (err as Error)?.message || 'Request failed';
const label = (value: string) => value.replaceAll('_', ' ');

export function SupportPage() {
  const user = useAuthStore((state) => state.user);
  const admin = String(user?.role).toUpperCase() === 'ADMIN';
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: '', status: '', category: '', priority: '' });
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [messagePage, setMessagePage] = useState(1);
  const [messageTotal, setMessageTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ category: 'TASK', subject: '', description: '', taskId: '', paymentId: '' });
  const [evidence, setEvidence] = useState<string[]>([]);
  const [reply, setReply] = useState('');
  const [replyEvidence, setReplyEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [success, setSuccess] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true); setError(''); setListError('');
    try {
      const params = { page, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) };
      const { data } = await api.support.list(params);
      setTickets(data.items); setTotal(data.total);
    } catch (err) { setTickets([]); setTotal(0); setListError(errorText(err)); }
    finally { setLoading(false); }
  }, [page, filters]);
  useEffect(() => { void loadList(); }, [loadList]);

  async function openTicket(id: number) {
    setLoading(true); setError(''); setCreating(false);
    try {
      const [ticket, conversation, history] = await Promise.all([api.support.get(id), api.support.messages(id), api.support.activity(id)]);
      setSelected(ticket.data); setMessages(conversation.data.items); setMessageTotal(conversation.data.total); setMessagePage(1);
      setActivities(history.data.items); setActivityTotal(history.data.total); setActivityPage(1);
    } catch (err) { setError(errorText(err)); }
    finally { setLoading(false); }
  }
  async function upload(files: FileList | null, target: 'ticket' | 'reply') {
    if (!files?.length) return;
    const previous = target === 'ticket' ? evidence : replyEvidence;
    if (previous.length + files.length > 5) { setError('Maximum 5 evidence images'); return; }
    setBusy(true); setError('');
    try {
      const urls = await Promise.all(Array.from(files).map(uploadImageToCloudinary));
      if (target === 'ticket') setEvidence([...previous, ...urls]); else setReplyEvidence([...previous, ...urls]);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  async function createTicket(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      const { data } = await api.support.create({ category: form.category, subject: form.subject, description: form.description,
        ...(form.taskId ? { taskId: Number(form.taskId) } : {}), ...(form.paymentId ? { paymentId: Number(form.paymentId) } : {}), evidenceUrls: evidence });
      setForm({ category: 'TASK', subject: '', description: '', taskId: '', paymentId: '' }); setEvidence([]); setSuccess('Ticket submitted');
      await loadList(); await openTicket(data.id);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  async function sendReply(event: React.FormEvent) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError(''); setSuccess('');
    try { await api.support.reply(selected.id, { body: reply, evidenceUrls: replyEvidence }); setReply(''); setReplyEvidence([]); setSuccess('Reply sent'); await openTicket(selected.id); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function updateTicket(data: Record<string, string>) {
    if (!selected) return; setBusy(true); setError('');
    try { await api.support.update(selected.id, data); setSuccess('Ticket updated'); await openTicket(selected.id); await loadList(); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function olderMessages() {
    if (!selected) return;
    try { const next = messagePage + 1; const { data } = await api.support.messages(selected.id, next); setMessages((items) => [...items, ...data.items]); setMessagePage(next); }
    catch (err) { setError(errorText(err)); }
  }
  async function olderActivity() {
    if (!selected) return;
    try { const next = activityPage + 1; const { data } = await api.support.activity(selected.id, next); setActivities((items) => [...items, ...data.items]); setActivityPage(next); }
    catch (err) { setError(errorText(err)); }
  }
  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2';
  const button = 'rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50';
  const evidenceView = (urls: string[]) => urls.length ? <div className="flex flex-wrap gap-2">{urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-blue-600 underline">Evidence image</a>)}</div> : null;
  return <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
    <h1 className="text-3xl font-bold">{admin ? 'Support tickets' : 'Customer support'}</h1>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
    {listError && <div role="alert" className="rounded bg-red-50 p-3 text-red-700">{listError} <button type="button" className="ml-2 underline" onClick={() => void loadList()}>Retry</button></div>}
    {success && <p role="status" className="rounded bg-green-50 p-3 text-green-700">{success}</p>}
    {selected ? <section className="space-y-4 rounded-xl border bg-white p-5">
      <button type="button" onClick={() => { setSelected(null); void loadList(); }} className="text-blue-600">← All tickets</button>
      <h2 className="text-2xl font-semibold">#{selected.id} {selected.subject}</h2>
      <p>{label(selected.category)} · {label(selected.status)} · {label(selected.priority)}{admin ? ` · ${selected.requester?.name}` : ''}</p>
      <p className="whitespace-pre-wrap">{selected.description}</p>{evidenceView(selected.evidenceUrls)}
      {(selected.taskId || selected.paymentId) && <p>Task #{selected.taskId || '—'} · Payment #{selected.paymentId || '—'}</p>}
      {admin && <div className="flex flex-wrap gap-3"><label>Status <select className={input} value={selected.status} disabled={busy} onChange={(e) => void updateTicket({ status: e.target.value })}>{statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></label>
        <label>Priority <select className={input} value={selected.priority} disabled={busy} onChange={(e) => void updateTicket({ priority: e.target.value })}>{priorities.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select></label></div>}
      <h3 className="text-lg font-semibold">Conversation</h3>
      {messages.length === 0 && <p>No replies yet.</p>}
      {messages.map((message) => <article key={message.id} className="rounded-lg bg-gray-50 p-3"><p className="text-sm text-gray-600">{message.sender.name} · {new Date(message.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap">{message.body}</p>{evidenceView(message.evidenceUrls)}</article>)}
      {messages.length < messageTotal && <button type="button" onClick={() => void olderMessages()} className="text-blue-600">Load older replies</button>}
      {selected.status !== 'CLOSED' && <form onSubmit={sendReply} className="space-y-2"><textarea className={input} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply" required maxLength={10000} rows={4} />
        <input type="file" accept="image/*" multiple onChange={(e) => void upload(e.target.files, 'reply')} />{evidenceView(replyEvidence)}
        <button className={button} disabled={busy}>Send reply</button></form>}
      <h3 className="text-lg font-semibold">Activity</h3>
      {activities.map((item) => <p key={item.id} className="text-sm text-gray-600">{new Date(item.createdAt).toLocaleString()} · {item.actor.name}: {label(item.action)} {item.fromValue ? `${label(item.fromValue)} → ` : ''}{item.toValue && label(item.toValue)}</p>)}
      {activities.length < activityTotal && <button type="button" onClick={() => void olderActivity()} className="text-blue-600">Load older activity</button>}
    </section> : <>
      {!admin && <button type="button" className={button} onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : 'New ticket'}</button>}
      {creating && <form onSubmit={createTicket} className="space-y-3 rounded-xl border bg-white p-5">
        <label className="block">Category<select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categories.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></label>
        <label className="block">Subject<input className={input} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} minLength={3} maxLength={160} required /></label>
        <label className="block">Description<textarea className={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} minLength={10} maxLength={10000} rows={5} required /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label>Related task ID (optional)<input type="number" min="1" className={input} value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })} /></label>
          <label>Related payment ID (optional)<input type="number" min="1" className={input} value={form.paymentId} onChange={(e) => setForm({ ...form, paymentId: e.target.value })} /></label></div>
        <label className="block">Evidence images (optional)<input type="file" accept="image/*" multiple onChange={(e) => void upload(e.target.files, 'ticket')} /></label>{evidenceView(evidence)}
        <button className={button} disabled={busy}>Submit ticket</button></form>}
      <div className="grid gap-2 rounded-xl border bg-white p-4 sm:grid-cols-4"><input className={input} placeholder="Search tickets" value={filters.search} onChange={(e) => { setPage(1); setFilters({ ...filters, search: e.target.value }); }} />
        {(['status', 'category', 'priority'] as const).map((key) => <select key={key} className={input} value={filters[key]} onChange={(e) => { setPage(1); setFilters({ ...filters, [key]: e.target.value }); }}><option value="">All {key}</option>{(key === 'status' ? statuses : key === 'category' ? categories : priorities).map((value) => <option key={value} value={value}>{label(value)}</option>)}</select>)}</div>
      {loading ? <p>Loading tickets...</p> : listError ? null : tickets.length === 0 ? <p>No tickets found.</p> : tickets.map((ticket) => <button key={ticket.id} type="button" onClick={() => void openTicket(ticket.id)} className="block w-full rounded-xl border bg-white p-4 text-left hover:border-blue-500"><strong>#{ticket.id} {ticket.subject}</strong><p>{label(ticket.category)} · {label(ticket.status)} · {label(ticket.priority)}{admin ? ` · ${ticket.requester?.name}` : ''}</p><small>{new Date(ticket.createdAt).toLocaleString()}</small></button>)}
      {!listError && <div className="flex items-center gap-3"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.max(1, Math.ceil(total / 20))}</span><button disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Next</button></div>}
    </>}
  </div>;
}
