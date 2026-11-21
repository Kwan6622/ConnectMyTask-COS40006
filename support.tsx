import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { MarketplaceShell } from '@/components/MarketplaceShell';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/services/api';
import { uploadImageToCloudinary } from '@/utils/cloudinaryUpload';
import { colors } from '@/theme/tokens';

type Ticket = { id: number; subject: string; description: string; category: string; status: string; priority: string; evidenceUrls: string[]; requester?: { name: string }; taskId?: number; paymentId?: number; createdAt: string };
type Message = { id: number; body: string; evidenceUrls: string[]; createdAt: string; sender: { name: string } };
type Activity = { id: number; action: string; fromValue?: string; toValue?: string; createdAt: string; actor: { name: string } };
const categories = ['TASK', 'BIDDING', 'PAYMENT', 'ACCOUNT', 'TECHNICAL', 'OTHER'];
const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const label = (text: string) => text.replaceAll('_', ' ');
const errorText = (err: unknown) => (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message || (err as Error)?.message || 'Request failed';

export default function SupportScreen(): React.ReactElement {
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore((state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }));
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
  const [category, setCategory] = useState('TASK');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [taskId, setTaskId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [reply, setReply] = useState('');
  const [replyEvidence, setReplyEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [success, setSuccess] = useState('');
  const loadList = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true); setError(''); setListError('');
    try {
      const params = { page, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) };
      const { data } = await api.support.list(params);
      setTickets(data.items); setTotal(data.total);
    } catch (err) { setTickets([]); setTotal(0); setListError(errorText(err)); } finally { setLoading(false); }
  }, [page, filters, isAuthenticated]);
  useEffect(() => { void loadList(); }, [loadList]);

  async function openTicket(id: number) {
    setLoading(true); setError(''); setCreating(false);
    try {
      const [ticket, conversation, history] = await Promise.all([api.support.get(id), api.support.messages(id), api.support.activity(id)]);
      setSelected(ticket.data); setMessages(conversation.data.items); setMessageTotal(conversation.data.total); setMessagePage(1);
      setActivities(history.data.items); setActivityTotal(history.data.total); setActivityPage(1);
    } catch (err) { setError(errorText(err)); } finally { setLoading(false); }
  }
  async function addEvidence(target: 'ticket' | 'reply') {
    const existing = target === 'ticket' ? evidence : replyEvidence;
    if (existing.length >= 5) { setError('Maximum 5 evidence images'); return; }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { setError('Photo permission is required'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true, selectionLimit: 5 - existing.length });
      if (result.canceled) return;
      setBusy(true); setError('');
      const urls = await Promise.all(result.assets.map((asset) => uploadImageToCloudinary(asset)));
      if (target === 'ticket') setEvidence([...existing, ...urls]); else setReplyEvidence([...existing, ...urls]);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function createTicket() {
    setBusy(true); setError(''); setSuccess('');
    try {
      const { data } = await api.support.create({ category, subject, description, ...(taskId ? { taskId: Number(taskId) } : {}), ...(paymentId ? { paymentId: Number(paymentId) } : {}), evidenceUrls: evidence });
      setSubject(''); setDescription(''); setTaskId(''); setPaymentId(''); setEvidence([]); setSuccess('Ticket submitted');
      await loadList(); await openTicket(data.id);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function sendReply() {
    if (!selected) return; setBusy(true); setError(''); setSuccess('');
    try { await api.support.reply(selected.id, { body: reply, evidenceUrls: replyEvidence }); setReply(''); setReplyEvidence([]); setSuccess('Reply sent'); await openTicket(selected.id); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function updateTicket(data: Record<string, string>) {
    if (!selected) return; setBusy(true); setError('');
    try { await api.support.update(selected.id, data); setSuccess('Ticket updated'); await openTicket(selected.id); await loadList(); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function loadOlder(kind: 'messages' | 'activity') {
    if (!selected) return;
    try {
      if (kind === 'messages') { const next = messagePage + 1; const { data } = await api.support.messages(selected.id, next); setMessages((items) => [...items, ...data.items]); setMessagePage(next); }
      else { const next = activityPage + 1; const { data } = await api.support.activity(selected.id, next); setActivities((items) => [...items, ...data.items]); setActivityPage(next); }
    } catch (err) { setError(errorText(err)); }
  }
  const optionRow = (values: string[], current: string, onChange: (value: string) => void) =>
    <View style={styles.row}>{values.map((value) => <Pressable key={value} onPress={() => onChange(value)} style={[styles.chip, current === value && styles.activeChip]}><Text style={current === value ? styles.activeText : styles.text}>{value ? label(value) : 'All'}</Text></Pressable>)}</View>;
  const evidenceLinks = (urls: string[]) => urls.map((url, index) => <Text key={`${url}-${index}`} onPress={() => void Linking.openURL(url)} style={styles.link}>Evidence image {index + 1}</Text>);
  return <MarketplaceShell activeRoute="support">
    {!isAuthenticated ? <Card><Text style={styles.title}>Sign in for customer support</Text><Button title="Sign in" onPress={() => router.push('/sign-in')} /></Card> : <>
      <Card><Text style={styles.title}>{admin ? 'Support tickets' : 'Customer support'}</Text><Button title="Refresh" variant="outline" onPress={() => void (selected ? openTicket(selected.id) : loadList())} /></Card>
      {!!error && <Card><Text style={styles.error}>{error}</Text></Card>}
      {!!listError && <Card><Text style={styles.error}>{listError}</Text></Card>}
      {!!success && <Card><Text style={styles.success}>{success}</Text></Card>}
      {loading && <ActivityIndicator />}
      {selected ? <Card>
        <Button title="All tickets" variant="outline" onPress={() => { setSelected(null); void loadList(); }} />
        <Text style={styles.title}>#{selected.id} {selected.subject}</Text>
        <Text style={styles.text}>{label(selected.category)} · {label(selected.status)} · {label(selected.priority)}{admin ? ` · ${selected.requester?.name}` : ''}</Text>
        <Text style={styles.text}>{selected.description}</Text>{evidenceLinks(selected.evidenceUrls)}
        {(selected.taskId || selected.paymentId) && <Text style={styles.text}>Task #{selected.taskId || '—'} · Payment #{selected.paymentId || '—'}</Text>}
        {admin && <><Text style={styles.subtitle}>Status</Text>{optionRow(statuses, selected.status, (status) => void updateTicket({ status }))}<Text style={styles.subtitle}>Priority</Text>{optionRow(priorities, selected.priority, (priority) => void updateTicket({ priority }))}</>}
        <Text style={styles.subtitle}>Conversation</Text>
        {messages.length === 0 && <Text style={styles.text}>No replies yet.</Text>}
        {messages.map((message) => <View key={message.id} style={styles.item}><Text style={styles.meta}>{message.sender.name} · {new Date(message.createdAt).toLocaleString()}</Text><Text style={styles.text}>{message.body}</Text>{evidenceLinks(message.evidenceUrls)}</View>)}
        {messages.length < messageTotal && <Button title="Load older replies" variant="outline" onPress={() => void loadOlder('messages')} />}
        {selected.status !== 'CLOSED' && <><TextInput style={[styles.input, styles.multiline]} multiline placeholder="Write a reply" value={reply} onChangeText={setReply} maxLength={10000} /><Button title="Add evidence images" variant="outline" onPress={() => void addEvidence('reply')} />{evidenceLinks(replyEvidence)}<Button title="Send reply" loading={busy} disabled={!reply.trim()} onPress={() => void sendReply()} /></>}
        <Text style={styles.subtitle}>Activity</Text>
        {activities.map((item) => <Text key={item.id} style={styles.meta}>{new Date(item.createdAt).toLocaleString()} · {item.actor.name}: {label(item.action)} {item.fromValue ? `${label(item.fromValue)} → ` : ''}{item.toValue && label(item.toValue)}</Text>)}
        {activities.length < activityTotal && <Button title="Load older activity" variant="outline" onPress={() => void loadOlder('activity')} />}
      </Card> : <>
        {!admin && <Button title={creating ? 'Cancel' : 'New ticket'} onPress={() => setCreating(!creating)} />}
        {creating && <Card><Text style={styles.subtitle}>Category</Text>{optionRow(categories, category, setCategory)}
          <TextInput style={styles.input} placeholder="Subject" value={subject} onChangeText={setSubject} maxLength={160} />
          <TextInput style={[styles.input, styles.multiline]} multiline placeholder="Detailed description" value={description} onChangeText={setDescription} maxLength={10000} />
          <TextInput style={styles.input} placeholder="Related task ID (optional)" keyboardType="numeric" value={taskId} onChangeText={setTaskId} />
          <TextInput style={styles.input} placeholder="Related payment ID (optional)" keyboardType="numeric" value={paymentId} onChangeText={setPaymentId} />
          <Button title="Add evidence images" variant="outline" onPress={() => void addEvidence('ticket')} />{evidenceLinks(evidence)}
          <Button title="Submit ticket" loading={busy} disabled={subject.trim().length < 3 || description.trim().length < 10} onPress={() => void createTicket()} />
        </Card>}
        <Card><TextInput style={styles.input} placeholder="Search tickets" value={filters.search} onChangeText={(search) => { setPage(1); setFilters({ ...filters, search }); }} />
          {(['status', 'category', 'priority'] as const).map((key) => <View key={key}><Text style={styles.subtitle}>{label(key)}</Text>{optionRow(['', ...(key === 'status' ? statuses : key === 'category' ? categories : priorities)], filters[key], (value) => { setPage(1); setFilters({ ...filters, [key]: value }); })}</View>)}</Card>
        {!loading && !listError && tickets.length === 0 && <Card><Text style={styles.text}>No tickets found.</Text></Card>}
        {tickets.map((ticket) => <Pressable key={ticket.id} onPress={() => void openTicket(ticket.id)}><Card><Text style={styles.subtitle}>#{ticket.id} {ticket.subject}</Text><Text style={styles.text}>{label(ticket.category)} · {label(ticket.status)} · {label(ticket.priority)}{admin ? ` · ${ticket.requester?.name}` : ''}</Text><Text style={styles.meta}>{new Date(ticket.createdAt).toLocaleString()}</Text></Card></Pressable>)}
        {!listError && <View style={styles.row}><Button title="Previous" variant="outline" disabled={page === 1} onPress={() => setPage(page - 1)} /><Text style={styles.text}>Page {page}/{Math.max(1, Math.ceil(total / 20))}</Text><Button title="Next" variant="outline" disabled={page * 20 >= total} onPress={() => setPage(page + 1)} /></View>}
      </>}
    </>}
  </MarketplaceShell>;
}

const styles = StyleSheet.create({
  title: { color: colors.dark[900], fontSize: 22, fontWeight: '800', marginBottom: 10 },
  subtitle: { color: colors.dark[900], fontSize: 16, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  text: { color: colors.dark[700], fontSize: 14, marginBottom: 8 },
  meta: { color: colors.dark[500], fontSize: 12, marginBottom: 6 },
  link: { color: '#2563eb', textDecorationLine: 'underline', marginVertical: 3 },
  error: { color: '#b91c1c' }, success: { color: '#15803d' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'center', marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: colors.dark[100], borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7 },
  activeChip: { backgroundColor: '#2563eb', borderColor: '#2563eb' }, activeText: { color: '#fff', fontSize: 12 },
  input: { borderWidth: 1, borderColor: colors.dark[100], borderRadius: 8, padding: 12, marginBottom: 10, color: colors.dark[900] },
  multiline: { minHeight: 100, textAlignVertical: 'top' }, item: { padding: 10, backgroundColor: '#f3f4f6', borderRadius: 8, marginVertical: 5 },
});
