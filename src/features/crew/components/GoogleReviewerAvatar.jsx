import { useState } from 'react';
import { UserRound } from 'lucide-react';

export default function GoogleReviewerAvatar({ reviewer }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const photoUrl = !reviewer?.isAnonymous && /^https:\/\//i.test(reviewer?.profilePhotoUrl || '') ? reviewer.profilePhotoUrl : null;
  const initials = !reviewer?.isAnonymous && (reviewer?.displayName || '').trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
  return <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-xs font-semibold text-text-secondary">
    {photoUrl && failedUrl !== photoUrl ? <img src={photoUrl} alt="" width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setFailedUrl(photoUrl)} /> : initials || <UserRound size={16} />}
  </span>;
}
