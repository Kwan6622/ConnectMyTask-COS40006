import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowPathIcon, LightBulbIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api } from '../services/api';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { TASK_CATEGORIES } from '../constants';
import { uploadImageToCloudinary } from '../utils/cloudinaryUpload';
import { formatVnd } from '../utils';
import type { RepostSuggestion, Task } from '../types';

/** ISO date -> value for <input type="datetime-local"> in local time. */
function toLocalInput(value?: string | Date | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const fieldClass = 'mt-1 w-full rounded-xl border border-gray-300 px-3 py-2.5 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500';

/**
 * Edit an EXPIRED task with tips that make it more attractive to providers,
 * then repost it (OPEN again with a new deadline) or delete it permanently.
 */
export const RepostTaskPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [bidCount, setBidCount] = useState(0);
  const [suggestions, setSuggestions] = useState<RepostSuggestion[]>([]);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [budget, setBudget] = useState('');
  const [maxBids, setMaxBids] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.tasks.getRepostSuggestions(id)
      .then((response) => {
        const data = response.data;
        const current: Task = data.task;
        setTask(current);
        setBidCount(Number(data.bidCount || 0));
        setSuggestions(data.suggestions || []);
        setTitle(current.title || '');
        setDescription(current.description || '');
        setCategory(String(current.category || ''));
        setBudget(current.budget ? String(current.budget) : '');
        setMaxBids(current.maxBids ? String(current.maxBids) : '');
        setImageUrls(Array.isArray(current.imageUrls) ? current.imageUrls : []);
      })
      .catch((error) => setLoadError(error?.response?.data?.message || 'This task cannot be reposted.'));
  }, [id]);

  const applySuggestion = (tip: RepostSuggestion) => {
    if (tip.suggestedValue == null) return;
    if (tip.field === 'budget') setBudget(String(tip.suggestedValue));
    if (tip.field === 'dueDate') setDueDate(toLocalInput(String(tip.suggestedValue)));
    if (tip.field === 'maxBids') setMaxBids(String(tip.suggestedValue));
    toast.success('Applied');
  };

  const handleImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).slice(0, 3 - imageUrls.length);
    if (!files.length) return;
    setIsUploading(true);
    try {
      const uploaded = await Promise.all(files.map((file) => uploadImageToCloudinary(file)));
      setImageUrls((current) => [...current, ...uploaded].slice(0, 3));
    } catch (error: any) {
      toast.error(error?.message || 'Image upload failed');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const handleRepost = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id) return;
    if (!dueDate || new Date(dueDate).getTime() <= Date.now()) {
      toast.error('Choose a new deadline in the future');
      return;
    }
    const budgetValue = Number(budget.replace(/\D/g, ''));
    if (!budgetValue) {
      toast.error('Enter a budget');
      return;
    }
    setIsSaving(true);
    try {
      await api.tasks.repost(id, {
        title: title.trim(),
        description: description.trim(),
        category,
        budget: budgetValue,
        ...(maxBids ? { maxBids: Number(maxBids) } : {}),
        dueDate: new Date(dueDate).toISOString(),
        imageUrls,
      });
      toast.success('Task reposted. Providers can bid again.');
      navigate(`/tasks/${id}`);
    } catch (error: any) {
      const details = error?.response?.data?.details;
      toast.error(error?.response?.data?.message || (Array.isArray(details) && details[0]?.message) || 'Could not repost the task');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm('Delete this task permanently? Its bids, checklist and history are removed and cannot be recovered.')) return;
    setIsDeleting(true);
    try {
      await api.tasks.deletePermanently(id);
      toast.success('Task deleted');
      navigate('/my-tasks');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Could not delete the task');
      setIsDeleting(false);
    }
  };

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-gray-700">{loadError}</p>
        <Link to="/my-tasks" className="mt-4 inline-block text-blue-600 underline">Back to My Tasks</Link>
      </div>
    );
  }
  if (!task) return <div className="p-6 text-center" aria-live="polite">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <Link to="/my-tasks" className="text-sm text-blue-600 hover:underline">&larr; My Tasks</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Edit and repost</h1>
        <p className="mt-1 text-gray-600">
          &ldquo;{task.title}&rdquo; expired
          {task.dueDate ? ` on ${new Date(task.dueDate).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
          {bidCount > 0 ? ` with ${bidCount} bid(s) but nobody assigned.` : ' with no bids.'} Only you can see it.
        </p>
      </div>

      {suggestions.length > 0 && (
        <Card className="p-5 border-amber-200 bg-amber-50">
          <h2 className="flex items-center gap-2 font-semibold text-amber-900">
            <LightBulbIcon className="h-5 w-5" /> How to get bids this time
          </h2>
          <ul className="mt-3 space-y-2">
            {suggestions.map((tip, index) => (
              <li key={`${tip.field}-${index}`} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-white/80 px-3 py-2 text-sm text-gray-800">
                <span className="flex-1 min-w-[12rem]">{tip.message}</span>
                {tip.suggestedValue != null && ['budget', 'dueDate', 'maxBids'].includes(tip.field) && (
                  <button
                    type="button"
                    onClick={() => applySuggestion(tip)}
                    className="rounded-lg border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    {tip.field === 'budget' ? `Use ${formatVnd(Number(tip.suggestedValue))}` : tip.field === 'dueDate' ? 'Use this deadline' : `Use ${tip.suggestedValue}`}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-6">
        <form onSubmit={handleRepost} className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Title
            <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Fix leaking kitchen tap" required />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Description
            <textarea
              className={`${fieldClass} resize-none`}
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Size of the job, materials, access, best time to come"
              required
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block text-sm font-medium text-gray-700">
              Category
              <select className={`${fieldClass} bg-white`} value={category} onChange={(e) => setCategory(e.target.value)}>
                {TASK_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Budget (VND)
              <input
                className={fieldClass}
                inputMode="numeric"
                value={budget ? Number(budget.replace(/\D/g, '') || 0).toLocaleString('en-US') : ''}
                onChange={(e) => setBudget(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 500,000"
                required
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Max bids
              <input className={fieldClass} type="number" min={1} max={100} value={maxBids} onChange={(e) => setMaxBids(e.target.value)} placeholder="e.g. 10" />
            </label>
          </div>
          <label className="block text-sm font-medium text-gray-700">
            New deadline *
            <input className={fieldClass} type="datetime-local" min={toLocalInput(new Date())} value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </label>

          <div>
            <p className="text-sm font-medium text-gray-700">Photos ({imageUrls.length}/3)</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {imageUrls.map((url) => (
                <div key={url} className="relative">
                  <img src={url} alt="Task" className="h-20 w-20 rounded-lg object-cover border" />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => setImageUrls((current) => current.filter((item) => item !== url))}
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-gray-900 text-xs text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
              {imageUrls.length < 3 && (
                <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-gray-300 text-xs text-gray-500 hover:border-blue-300">
                  {isUploading ? 'Uploading...' : '+ Add'}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleImages} disabled={isUploading} />
                </label>
              )}
            </div>
          </div>

          <p className="text-sm text-gray-500">Location stays the same: {task.location}</p>

          <div className="flex flex-col-reverse gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={handleDelete} disabled={isDeleting} className="text-red-600 border-red-200 hover:bg-red-50">
              <TrashIcon className="mr-2 h-5 w-5" />
              {isDeleting ? 'Deleting...' : 'Delete permanently'}
            </Button>
            <Button type="submit" disabled={isSaving || isUploading}>
              <ArrowPathIcon className="mr-2 h-5 w-5" />
              {isSaving ? 'Reposting...' : 'Repost task'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
