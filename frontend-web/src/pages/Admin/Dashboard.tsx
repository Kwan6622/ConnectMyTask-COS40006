import React, { useEffect, useMemo, useState } from 'react';
import { moneyStatusClasses, taskStatusClasses } from '../../utils/statusColors';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { api } from '../../services/api';
import { formatVnd } from '../../utils';
import toast from 'react-hot-toast';

type AdminTab = 'overview' | 'users' | 'tasks' | 'certificates' | 'payments' | 'fees' | 'disputes' | 'support';

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [suspiciousTasks, setSuspiciousTasks] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  // Users tab filters: name/email search, role and city.
  const [userSearch, setUserSearch] = useState('');
  const [userRole, setUserRole] = useState('ALL');
  const [userCity, setUserCity] = useState('ALL');
  const [disputes, setDisputes] = useState<any[]>([]);
  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [feeSettings, setFeeSettings] = useState<any | null>(null);
  const [feeType, setFeeType] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');
  const [feeValue, setFeeValue] = useState('20');
  const [feeActive, setFeeActive] = useState(true);
  const [feeReason, setFeeReason] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState('ALL');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN';

  const loadAdminData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const results = await Promise.allSettled([
        api.admin.getStats(),
        api.admin.getUsers(),
        api.admin.getTasks(),
        api.admin.getSuspiciousTasks(),
        api.admin.getCertificates(),
        api.admin.getPayments(),
        api.admin.getDisputes(),
        api.support.list({ limit: 50 }),
        api.admin.getPlatformFeeSettings(),
      ]);
      const data = (index: number) => {
        const result = results[index];
        return result?.status === 'fulfilled' ? result.value.data : undefined;
      };
      if (data(0) !== undefined) setStats(data(0) || null);
      if (data(1) !== undefined) setUsers(data(1) || []);
      if (data(2) !== undefined) setTasks(data(2) || []);
      if (data(3) !== undefined) setSuspiciousTasks(data(3) || []);
      if (data(4) !== undefined) setCertificates(data(4) || []);
      if (data(5) !== undefined) setPayments(data(5) || []);
      if (data(6) !== undefined) setDisputes(data(6) || []);
      if (data(7) !== undefined) setSupportTickets(data(7)?.items || []);
      if (data(8) !== undefined) {
        const settings = data(8) || null;
        setFeeSettings(settings);
        setFeeType(settings?.config?.feeType === 'FIXED' ? 'FIXED' : 'PERCENTAGE');
        setFeeValue(settings?.config?.feeType === 'FIXED'
          ? String(settings?.config?.fixedAmount ?? 0)
          : String(Number(settings?.config?.percentageRate ?? 0) * 100));
        setFeeActive(settings?.config?.isActive !== false);
      }
      const failedCount = results.filter((result) => result.status === 'rejected').length;
      if (failedCount) setLoadError(`${failedCount} admin section${failedCount === 1 ? '' : 's'} could not be loaded. Available sections remain usable.`);
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to load admin data';
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
      return;
    }
    loadAdminData();
  }, [isAdmin, navigate]);

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'certificates', label: 'Certificates' },
    { id: 'payments', label: 'Payments / Escrow' },
    { id: 'fees', label: 'Platform Fee' },
    { id: 'disputes', label: 'Disputes / Reports' },
    { id: 'support', label: 'Support' },
  ];

  const userCities = useMemo(
    () => Array.from(new Set(users.map((item) => item.cityName).filter(Boolean))).sort() as string[],
    [users]
  );
  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter((item) => {
      if (userRole !== 'ALL' && String(item.role).toUpperCase() !== userRole) return false;
      if (userCity === 'NONE' && item.cityName) return false;
      if (userCity !== 'ALL' && userCity !== 'NONE' && item.cityName !== userCity) return false;
      if (query && !`${item.name} ${item.email}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [users, userSearch, userRole, userCity]);

  const overviewCards = useMemo(() => ([
    { label: 'Total Users', value: stats?.totalUsers ?? 0 },
    { label: 'Active Tasks', value: stats?.activeTasks ?? 0 },
    { label: 'Suspicious Tasks', value: stats?.suspiciousTasks ?? 0 },
    { label: 'Escrow-held Payments', value: stats?.escrowHeldPayments ?? 0 },
    { label: 'Pending Certificates', value: stats?.pendingCertificates ?? 0 },
    { label: 'Disputes', value: stats?.disputes ?? 0 },
    { label: 'Open Support Tickets', value: stats?.openSupportTickets ?? 0 },
    { label: 'Escrow Held Amount', value: formatVnd(stats?.totalEscrowHeldAmount ?? 0) },
    { label: 'Platform Revenue', value: formatVnd(stats?.totalPlatformRevenue ?? 0) },
  ]), [stats]);

  const handleDeleteTask = async (taskId: string | number) => {
    const reason = window.prompt(
      'Remove this task? It is hidden everywhere and cancelled, and open bids are closed.\n'
      + 'Reason (sent to the requester and every provider who bid):'
    );
    if (reason === null) return;
    if (reason.trim().length < 5) {
      toast.error('Please give a reason of at least 5 characters');
      return;
    }
    try {
      const { data } = await api.admin.deleteTask(taskId, reason.trim());
      toast.success(`Task removed. The requester${data?.closedBids ? ` and ${data.closedBids} bidder(s)` : ''} were notified.`);
      loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to delete task');
    }
  };

  const handleReviewTask = async (taskId: string | number) => {
    try {
      await api.admin.reviewTask(taskId);
      toast.success('Task marked as reviewed');
      loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to review task');
    }
  };

  const handleCertificateAction = async (certificateId: string | number, action: 'verify' | 'reject') => {
    try {
      if (action === 'verify') {
        await api.admin.verifyCertificate(certificateId);
      } else {
        await api.admin.rejectCertificate(certificateId);
      }
      toast.success(`Certificate ${action}d`);
      loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update certificate');
    }
  };

  const handleReleasePayment = async (paymentId: string | number) => {
    if (!window.confirm('Release this funded escrow using the existing settlement rules?')) return;
    try {
      await api.admin.releasePayment(paymentId);
      toast.success('Escrow released');
      loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to release escrow');
    }
  };

  const handleUserStatus = async (target: any) => {
    const nextStatus = ['SUSPENDED', 'LOCKED'].includes(target.status) ? 'ACTIVE' : 'SUSPENDED';
    const question = target.status === 'LOCKED'
      ? `Reactivate ${target.email} now? The lock ends and the warnings reset to 0.`
      : `${nextStatus === 'SUSPENDED' ? 'Suspend' : 'Reactivate'} ${target.email}?`;
    if (!window.confirm(question)) return;
    try {
      await api.admin.updateUserStatus(target.id, nextStatus);
      toast.success(`User is now ${nextStatus.toLowerCase()}`);
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update user status');
    }
  };

  // Warnings: 3 lock the account for 3 days.
  const [warningHistory, setWarningHistory] = useState<Record<string, any[]>>({});
  const handleWarning = async (target: any, change: 1 | -1) => {
    const reason = window.prompt(change > 0
      ? `Reason for warning ${target.email} (shown to the user):`
      : `Reason for removing a warning from ${target.email}:`);
    if (!reason || reason.trim().length < 3) {
      if (reason !== null) toast.error('Please give a reason (at least 3 characters)');
      return;
    }
    try {
      const { data } = await api.admin.changeUserWarnings(target.id, change, reason.trim());
      toast.success(data.status === 'LOCKED'
        ? `Warning added. ${target.email} is locked until ${new Date(data.lockedUntil).toLocaleString()}`
        : `${target.email} now has ${data.warningCount}/3 warnings`);
      setWarningHistory((current) => { const next = { ...current }; delete next[String(target.id)]; return next; });
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to change warnings');
    }
  };
  const toggleWarningHistory = async (target: any) => {
    const key = String(target.id);
    if (warningHistory[key]) {
      setWarningHistory((current) => { const next = { ...current }; delete next[key]; return next; });
      return;
    }
    try {
      const { data } = await api.admin.getUserWarnings(target.id);
      setWarningHistory((current) => ({ ...current, [key]: data.warnings || [] }));
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to load warnings');
    }
  };

  const handleDispute = async (dispute: any, status: 'UNDER_REVIEW' | 'CLOSED') => {
    if (!window.confirm(`Set dispute #${dispute.id} to ${status}? No payment override will be performed.`)) return;
    try {
      await api.admin.reviewDispute(dispute.taskId, dispute.id, { status, action: 'NONE' });
      toast.success('Dispute updated');
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update dispute');
    }
  };

  const handleTaskStatus = async (task: any, status: string) => {
    const reason = window.prompt(`Reason for changing ${task.status} to ${status}:`)?.trim();
    if (!reason) return;
    try {
      await api.admin.updateTaskStatus(task.id, { status, reason });
      toast.success('Task status updated and audited');
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update task status');
    }
  };

  const handleFeeUpdate = async () => {
    const numericValue = Number(feeValue);
    if (!Number.isFinite(numericValue) || numericValue < 0 || feeReason.trim().length < 5) {
      toast.error('Enter a valid fee and a reason of at least 5 characters');
      return;
    }
    try {
      await api.admin.updatePlatformFeeSettings({
        feeType,
        ...(feeType === 'PERCENTAGE' ? { percentageRate: numericValue / 100 } : { fixedAmount: numericValue }),
        isActive: feeActive,
        reason: feeReason.trim(),
      });
      setFeeReason('');
      toast.success('Platform fee updated for future deposits');
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update platform fee');
    }
  };

  const taskTransitions: Record<string, string[]> = {
    PENDING: ['OPEN', 'CANCELLED'],
    OPEN: ['CANCELLED'],
    BIDDING: ['CANCELLED'],
    ASSIGNED: ['CANCELLED'],
  };

  const filteredTasks = taskStatusFilter === 'ALL' ? tasks : tasks.filter((task) => task.status === taskStatusFilter);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600 mt-2">Manage users, suspicious tasks, certificates, and escrow payments</p>
          </div>
          <Button onClick={loadAdminData} disabled={isLoading}>{isLoading ? 'Refreshing...' : 'Refresh'}</Button>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {tabs.map((item) => {
            // Items still needing action on this tab (locked users, unreviewed flags, pending certificates, ...).
            const pending = Number((stats?.attention as Record<string, number> | undefined)?.[item.id] || 0);
            return (
              <div key={item.id} className="relative">
                <Button variant={tab === item.id ? 'default' : 'outline'} onClick={() => setTab(item.id)}>
                  {item.label}
                </Button>
                {pending > 0 && (
                  <span
                    className="pointer-events-none absolute -top-2 -right-2 min-w-[1.25rem] rounded-full bg-red-600 px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-white shadow ring-2 ring-white"
                    aria-label={`${pending} item${pending === 1 ? '' : 's'} need attention`}
                  >
                    {pending > 99 ? '99+' : pending}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {loadError && (
          <Card className="p-4 mb-6 border border-red-200 bg-red-50">
            <p className="text-sm text-red-700">{loadError}</p>
            <Button className="mt-2" variant="outline" onClick={loadAdminData}>Retry</Button>
          </Card>
        )}

        {tab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {overviewCards.map((card) => (
              <Card key={card.label} className="p-5">
                <p className="text-sm text-gray-600">{card.label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">{card.value}</p>
              </Card>
            ))}
          </div>
        )}

        {tab === 'users' && (
          <Card className="p-4">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <p className="font-semibold text-gray-900">Users ({filteredUsers.length}{filteredUsers.length !== users.length ? ` of ${users.length}` : ''})</p>
              <div className="flex flex-wrap gap-2">
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name or email"
                  aria-label="Search users by name or email"
                  className="h-10 rounded-lg border border-gray-300 px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  aria-label="Filter by role"
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All roles</option>
                  <option value="REQUESTER">Requester</option>
                  <option value="PROVIDER">Provider</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <select
                  value={userCity}
                  onChange={(e) => setUserCity(e.target.value)}
                  aria-label="Filter by city"
                  className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">All cities</option>
                  {['Ho Chi Minh City', 'Hanoi', ...userCities.filter((city) => !['Ho Chi Minh City', 'Hanoi'].includes(city))].map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                  <option value="NONE">No city set</option>
                </select>
              </div>
            </div>
            <div className="space-y-3">
              {filteredUsers.map((item) => (
                <div key={item.id} className="border rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{item.name} <span className="text-xs text-gray-500">{item.role}</span></p>
                    <p className="text-sm text-gray-600">{item.email}</p>
                    <p className="text-xs text-gray-500">Status: {item.status} · Created tasks: {item._count?.tasksCreated || 0} · Disputes: {item._count?.disputesOpened || 0}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {item.location || 'No city set'} ·{' '}
                      {item.ratingCount > 0
                        ? <span className="font-semibold text-amber-600">★ {Number(item.averageRating).toFixed(1)} <span className="font-normal text-gray-500">({item.ratingCount} rating{item.ratingCount === 1 ? '' : 's'})</span></span>
                        : <span className="text-gray-500">No ratings yet</span>}
                    </p>
                    {String(item.role).toUpperCase() === 'PROVIDER' && (
                      <div className="mt-1 text-xs">
                        {item.verifiedDocuments?.length > 0 ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <span className="text-gray-500">Verified documents:</span>
                            {item.verifiedDocuments.map((doc: any) => (
                              <a
                                key={doc.id}
                                href={doc.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 hover:underline"
                                title={doc.certificateType}
                              >
                                ✓ {doc.title}
                              </a>
                            ))}
                          </span>
                        ) : (
                          <span className="text-gray-500">No verified documents yet</span>
                        )}
                      </div>
                    )}
                    {item.role !== 'ADMIN' && (
                      <p className={`text-xs mt-1 font-medium ${item.warningCount >= 3 ? 'text-red-700' : item.warningCount > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                        Warnings: {item.warningCount || 0}/3
                        {item.status === 'LOCKED' && item.lockedUntil ? ` · Locked until ${new Date(item.lockedUntil).toLocaleString()}` : ''}
                      </p>
                    )}
                  </div>
                  {item.role !== 'ADMIN' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" onClick={() => handleWarning(item, -1)} disabled={!item.warningCount} aria-label={`Remove a warning from ${item.email}`}>− Warning</Button>
                      <Button variant="outline" onClick={() => handleWarning(item, 1)} aria-label={`Add a warning to ${item.email}`}>+ Warning</Button>
                      <Button variant="outline" onClick={() => toggleWarningHistory(item)}>{warningHistory[String(item.id)] ? 'Hide history' : 'History'}</Button>
                      <Button variant="outline" onClick={() => handleUserStatus(item)}>{['SUSPENDED', 'LOCKED'].includes(item.status) ? 'Reactivate' : 'Suspend'}</Button>
                    </div>
                  )}
                  {warningHistory[String(item.id)] && (
                    <div className="w-full rounded-lg bg-gray-50 p-3 text-sm">
                      {warningHistory[String(item.id)].length === 0 ? (
                        <p className="text-gray-500">No warnings yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {warningHistory[String(item.id)].map((entry: any) => (
                            <li key={entry.id} className="flex flex-wrap justify-between gap-2">
                              <span>
                                <span className={entry.change > 0 ? 'font-semibold text-red-700' : 'font-semibold text-green-700'}>
                                  {entry.change > 0 ? `+${entry.change}` : entry.change}
                                </span>{' '}
                                {entry.reason}
                              </span>
                              <span className="text-xs text-gray-500">
                                {entry.countAfter}/3 · {new Date(entry.createdAt).toLocaleString()} · {entry.createdBy?.name || 'System'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {filteredUsers.length === 0 && !isLoading && <p className="text-sm text-gray-500">No users match these filters.</p>}
            </div>
          </Card>
        )}

        {tab === 'tasks' && (
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="font-semibold text-gray-900">All Tasks</p>
                <select value={taskStatusFilter} onChange={(event) => setTaskStatusFilter(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="ALL">All statuses</option>
                  {['PENDING', 'OPEN', 'BIDDING', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'EXPIRED'].map((status) => <option key={status}>{status}</option>)}
                </select>
              </div>
              <div className="space-y-2 max-h-[300px] overflow-auto">
                {filteredTasks.map((task) => (
                  <div key={task.id} className="border rounded-lg p-3">
                    <p className="font-semibold">{task.title}</p>
                    <p className="text-xs text-gray-500 flex flex-wrap items-center gap-1">{task.category} • <span className={`rounded-full border px-2 py-0.5 font-semibold ${taskStatusClasses(task.status)}`}>{task.status}</span></p>
                    <p className="text-xs text-gray-500">Requester: {task.createdBy?.name || '-'}</p>
                    <p className="text-xs text-gray-500 flex flex-wrap items-center gap-1">Provider: {task.assignedProvider?.name || 'Unassigned'} · Escrow: <span className={`rounded-full border px-2 py-0.5 font-semibold ${moneyStatusClasses(task.escrowStatus || 'NONE')}`}>{task.escrowStatus || 'NONE'}</span> · Payment: <span className={`rounded-full border px-2 py-0.5 font-semibold ${moneyStatusClasses(task.paymentStatus || 'UNPAID')}`}>{task.paymentStatus || 'UNPAID'}</span></p>
                    <p className="text-xs text-gray-500">GPS: {task.gpsVerificationStatus || 'NOT_REQUIRED'} · Disputes: {task._count?.disputes || 0}</p>
                    {(taskTransitions[task.status] || []).length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {(taskTransitions[task.status] || []).map((status) => (
                          <Button key={status} size="sm" variant="outline" onClick={() => handleTaskStatus(task, status)}>{status}</Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {filteredTasks.length === 0 && <p className="text-sm text-gray-500">No tasks found.</p>}
              </div>
            </Card>
            <Card className="p-4">
              <p className="font-semibold text-gray-900 mb-2">Suspicious / Flagged Tasks</p>
              {suspiciousTasks.map((task) => (
                <div key={task.id} className={`border rounded-lg p-3 mb-2 ${task.reviewedByAdminAt ? 'opacity-70' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{task.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${task.riskLevel === 'HIGH' ? 'bg-red-600 text-white' : 'bg-amber-200 text-amber-900'}`}>
                      {task.riskLevel === 'HIGH' ? 'High risk' : 'Medium risk'}
                    </span>
                    {task.reviewedByAdminAt && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Reviewed</span>
                    )}
                  </div>
                  <p className="text-sm text-red-700">{task.suspiciousReason || 'Flagged as suspicious'}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Posted by: {task.createdBy?.name || 'Unknown'} · Budget: {formatVnd(Number(task.budget || 0))} · {task.category} · <span className={`rounded-full border px-1.5 ${taskStatusClasses(task.status)}`}>{task.status}</span>
                  </p>
                  <div className="flex gap-2 mt-2">
                    {!task.reviewedByAdminAt && <Button variant="outline" onClick={() => handleReviewTask(task.id)}>Mark Reviewed</Button>}
                    <Button variant="outline" onClick={() => navigate(`/tasks/${task.id}`)}>Open task</Button>
                    <Button variant="outline" onClick={() => handleDeleteTask(task.id)} className="text-red-600 border-red-200 hover:bg-red-50">Remove task</Button>
                  </div>
                </div>
              ))}
              {suspiciousTasks.length === 0 && <p className="text-sm text-gray-500">No suspicious tasks.</p>}
            </Card>
          </div>
        )}

        {tab === 'certificates' && (
          <Card className="p-4">
            {(['PENDING', 'REVIEWED'] as const).map((group) => {
              const list = certificates.filter((cert) => (cert.verificationStatus === 'PENDING') === (group === 'PENDING'));
              return (
                <div key={group} className={group === 'REVIEWED' ? 'mt-6' : ''}>
                  <p className="font-semibold text-gray-900 mb-3">
                    {group === 'PENDING' ? `Waiting for review (${list.length})` : `Reviewed (${list.length})`}
                  </p>
                  <div className="space-y-3">
                    {list.map((cert) => (
                      <div key={cert.id} className="border rounded-lg p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold">{cert.title}</p>
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            cert.verificationStatus === 'VERIFIED'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : cert.verificationStatus === 'REJECTED'
                                ? 'bg-red-50 text-red-700 border-red-300'
                                : 'bg-yellow-50 text-yellow-800 border-yellow-300'
                          }`}>
                            {cert.verificationStatus}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{cert.certificateType}</p>
                        <p className="text-xs text-gray-500">Provider: {cert.provider?.name} ({cert.provider?.email})</p>
                        {cert.verifiedAt && (
                          <p className="text-xs text-gray-500">
                            {cert.verificationStatus === 'REJECTED' ? 'Rejected' : 'Verified'} {new Date(cert.verifiedAt).toLocaleString()}
                            {cert.verifiedByAdmin?.name ? ` by ${cert.verifiedByAdmin.name}` : ''}
                          </p>
                        )}
                        <a href={cert.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">Open document</a>
                        {group === 'PENDING' && (
                          <div className="flex gap-2 mt-2">
                            <Button variant="outline" onClick={() => handleCertificateAction(cert.id, 'verify')}>Verify</Button>
                            <Button variant="outline" onClick={() => handleCertificateAction(cert.id, 'reject')}>Reject</Button>
                          </div>
                        )}
                      </div>
                    ))}
                    {list.length === 0 && (
                      <p className="text-sm text-gray-500">{group === 'PENDING' ? 'Nothing waiting for review.' : 'No reviewed certificates yet.'}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        )}

        {tab === 'payments' && (
          <Card className="p-4">
            <p className="font-semibold text-gray-900 mb-3">Escrow & Payment Transactions</p>
            <div className="space-y-3">
              {payments.map((payment) => (
                <div key={payment.id} className="border rounded-lg p-3">
                  <p className="font-semibold">{payment.task?.title || `Task #${payment.taskId}`}</p>
                  <p className="text-xs text-gray-500">Requester: {payment.payer?.name || '-'}</p>
                  <p className="text-xs text-gray-500">Provider: {payment.provider?.name || '-'}</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2 text-sm">
                    <p>Total paid: <span className="font-semibold">{formatVnd(payment.totalAmount || payment.amount || 0)}</span></p>
                    <p>Platform fee: <span className="font-semibold">{formatVnd(payment.platformFeeAmount || 0)}</span></p>
                    <p>Provider payout: <span className="font-semibold">{formatVnd(payment.providerPayoutAmount || 0)}</span></p>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Lifecycle: {payment.lifecycleStatus || 'PENDING'}</p>
                  {payment.lifecycleStatus === 'ESCROW_HELD' && (
                    <Button className="mt-2" onClick={() => handleReleasePayment(payment.id)}>Release Escrow</Button>
                  )}
                </div>
              ))}
              {payments.length === 0 && <p className="text-sm text-gray-500">No payments.</p>}
            </div>
          </Card>
        )}

        {tab === 'fees' && (
          <Card className="p-4">
            <p className="font-semibold text-gray-900">Platform Fee Settings</p>
            <p className="text-sm text-gray-600 mt-1">Applies only to future escrow deposits. Requesters pay the accepted bid; the fee is deducted from provider payout.</p>
            {feeSettings?.migrationRequired && <p className="mt-2 text-sm text-amber-700">Prepared database migration must be reviewed and applied before settings can be changed.</p>}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
              <select value={feeType} onChange={(event) => setFeeType(event.target.value as 'PERCENTAGE' | 'FIXED')} className="rounded-lg border border-gray-300 px-3 py-2">
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED">Fixed VND</option>
              </select>
              <Input label={feeType === 'PERCENTAGE' ? 'Fee percent' : 'Fixed fee (VND)'} value={feeValue} onChange={(event) => setFeeValue(event.target.value)} type="number" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={feeActive} onChange={(event) => setFeeActive(event.target.checked)} /> Active</label>
              <Input label="Change reason" value={feeReason} onChange={(event) => setFeeReason(event.target.value)} />
            </div>
            <Button className="mt-3" onClick={handleFeeUpdate} disabled={Boolean(feeSettings?.migrationRequired)}>Save for future deposits</Button>
            <div className="mt-5 space-y-2">
              <p className="text-sm font-semibold">Recent audit history</p>
              {(feeSettings?.audits || []).map((audit: any) => <p key={audit.id} className="text-xs text-gray-600">{new Date(audit.createdAt).toLocaleString()} · {audit.changedBy?.name || 'Admin'} · {audit.reason}</p>)}
              {(feeSettings?.audits || []).length === 0 && <p className="text-xs text-gray-500">No persisted changes yet.</p>}
            </div>
          </Card>
        )}

        {tab === 'disputes' && (
          <Card className="p-4">
            <p className="font-semibold text-gray-900 mb-3">Disputes</p>
            <div className="space-y-3">
              {disputes.map((dispute) => (
                <div key={dispute.id} className="border rounded-lg p-3">
                  <p className="font-semibold">{dispute.task?.title || `Task #${dispute.taskId}`}</p>
                  <p className="text-sm text-gray-700">{dispute.reason}: {dispute.description || 'No description'}</p>
                  <p className="text-xs text-gray-500">Status: {dispute.status} · Escrow: {dispute.task?.escrowStatus || 'NONE'} · Opened by: {dispute.openedBy?.name || '-'}</p>
                  {['OPEN', 'UNDER_REVIEW'].includes(dispute.status) && <div className="flex gap-2 mt-2"><Button variant="outline" onClick={() => handleDispute(dispute, 'UNDER_REVIEW')}>Review</Button><Button variant="outline" onClick={() => handleDispute(dispute, 'CLOSED')}>Close (no settlement)</Button></div>}
                </div>
              ))}
              {disputes.length === 0 && <p className="text-sm text-gray-500">No disputes.</p>}
            </div>
          </Card>
        )}

        {tab === 'support' && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3"><p className="font-semibold text-gray-900">Support Tickets</p><Button variant="outline" onClick={() => navigate('/support')}>Open Support Center</Button></div>
            <div className="space-y-3">
              {supportTickets.map((ticket) => <div key={ticket.id} className="border rounded-lg p-3"><p className="font-semibold">{ticket.subject}</p><p className="text-xs text-gray-500">{ticket.category} · {ticket.priority} · {ticket.status} · {ticket.requester?.name || '-'}</p></div>)}
              {supportTickets.length === 0 && <p className="text-sm text-gray-500">No support tickets.</p>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
