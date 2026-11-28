import React, { useEffect, useMemo } from 'react';
import { taskStatusClasses } from '../utils/statusColors';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  BanknotesIcon,
  ChartBarIcon,
  ClockIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { useAuthStore } from '../stores/auth.store';
import { useTaskStore } from '../stores/task.store';
import { formatVnd } from '../utils';


function statusLabel(status: string) {
  return status.split('_').join(' ');
}

export const RequesterDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { requesterTasks, fetchRequesterTasks, isLoading } = useTaskStore();

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (String(user.role).toUpperCase() !== 'REQUESTER' && String(user.role).toUpperCase() !== 'CLIENT') {
      navigate('/browse-tasks');
      return;
    }
    fetchRequesterTasks();
  }, [fetchRequesterTasks, navigate, user]);

  const metrics = useMemo(() => {
    const assigned = requesterTasks.filter((task) => task.assignedProviderId != null).length;
    const inProgress = requesterTasks.filter((task) => ['IN_PROGRESS', 'PENDING_CONFIRMATION'].includes(task.status)).length;
    const totalBids = requesterTasks.reduce((sum, task) => sum + (task._count?.bids ?? task.bids?.length ?? 0), 0);
    const totalBudget = requesterTasks.reduce((sum, task) => sum + Number(task.budget || 0), 0);

    return {
      posted: requesterTasks.length,
      assigned,
      inProgress,
      totalBids,
      totalBudget,
    };
  }, [requesterTasks]);

  // Deadline passed with nobody assigned: listed apart, with edit/repost or delete.
  const expiredTasks = requesterTasks.filter((task) => task.status === 'EXPIRED');
  const activeTasks = requesterTasks.filter((task) => task.status !== 'EXPIRED');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 py-8">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="rounded-3xl bg-white border border-slate-200 shadow-lg p-6 mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide font-semibold text-blue-600">Requester Workspace</p>
              <h1 className="text-3xl font-bold text-slate-900 mt-1">Task Progress Dashboard</h1>
              <p className="text-slate-600 mt-2">
                Track assigned work, review bids, and monitor provider progress updates transparently.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => navigate('/transactions')}>Transaction History</Button>
              <Button variant="outline" onClick={() => fetchRequesterTasks()}>
                <ArrowPathIcon className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={() => navigate('/post-task')}>Post Task</Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">My Posted Tasks</p>
                <ChartBarIcon className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-2">{metrics.posted}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">Assigned Tasks</p>
                <UserGroupIcon className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-2">{metrics.assigned}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">Task Progress</p>
                <ClockIcon className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-2">{metrics.inProgress}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">Budget Pipeline</p>
                <BanknotesIcon className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900 mt-2">{formatVnd(metrics.totalBudget)}</p>
            </div>
          </div>
        </div>

        {expiredTasks.length > 0 && (
          <Card className="p-5 mb-6 border border-gray-300 bg-gray-50">
            <h2 className="text-lg font-bold text-slate-900">Expired tasks ({expiredTasks.length})</h2>
            <p className="text-sm text-slate-600 mt-1">
              These passed their deadline before a provider was assigned, so they were removed from browsing. Only you can see them.
              Edit and repost them with a new deadline (raising the budget or adding photos helps), or delete them permanently.
            </p>
            <div className="mt-4 space-y-3">
              {expiredTasks.map((task) => {
                const bids = task._count?.bids ?? task.bids?.length ?? 0;
                return (
                  <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
                    <div className="min-w-[220px] flex-1">
                      <p className="font-semibold text-slate-900">{task.title}</p>
                      <p className="text-sm text-slate-600">
                        {task.location} · {formatVnd(Number(task.budget || 0))} · {bids > 0 ? `${bids} bid(s), nobody assigned` : 'no bids'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => navigate(`/tasks/${task.id}/repost`)}>Edit &amp; repost</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {isLoading ? (
          <Card className="text-center py-12">Loading your tasks...</Card>
        ) : activeTasks.length === 0 && expiredTasks.length === 0 ? (
          <Card className="text-center py-12">
            <p className="text-slate-700 mb-4">No posted tasks yet.</p>
            <Button onClick={() => navigate('/post-task')}>Create first task</Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {activeTasks.map((task) => {
              const bidCount = task._count?.bids ?? task.bids?.length ?? 0;
              // A cancelled task can only be viewed.
              const canOpenProgress = task.status !== 'CANCELLED'
                && Boolean(task.assignedProviderId || ['IN_PROGRESS', 'PENDING_CONFIRMATION', 'COMPLETED', 'AWAITING_PAYMENT', 'PAID'].includes(task.status));
              const style = taskStatusClasses(task.status);

              return (
                <Card key={task.id} className="p-5 border-0 shadow-md hover:shadow-lg transition-shadow">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 min-w-[280px]">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link to={`/tasks/${task.id}`} className="text-lg font-semibold text-slate-900 hover:text-blue-600">
                          {task.title}
                        </Link>
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${style}`}>
                          {statusLabel(task.status)}
                        </span>
                      </div>
                      <p className="text-slate-600 mt-2 line-clamp-2">{task.description}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4 text-sm">
                        <p className="text-slate-600">Bids: <span className="font-semibold text-slate-900">{bidCount}</span></p>
                        <p className="text-slate-600">Original budget: <span className="font-semibold text-slate-900">{task.budget != null ? formatVnd(task.budget) : 'Flexible'}</span></p>
                        {task.escrowAmount != null && <p className="text-blue-700">Agreed price: <span className="font-semibold">{formatVnd(task.escrowAmount)}</span></p>}
                        <p className="text-slate-600">Assigned: <span className="font-semibold text-slate-900">{task.assignedProvider?.name || 'Not assigned'}</span></p>
                        <p className="text-slate-600">Created: <span className="font-semibold text-slate-900">{new Date(task.createdAt).toLocaleDateString()}</span></p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button variant="outline" onClick={() => navigate(`/tasks/${task.id}`)}>
                        View Task
                      </Button>
                      {canOpenProgress && (
                        <Button onClick={() => navigate(`/tasks/${task.id}/progress`)}>
                          Track Progress
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
