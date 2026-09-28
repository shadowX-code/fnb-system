import { useState } from 'react';
import Modal from '../../../../components/feedback/Modal.jsx';
import InventoryWasteDetailModal from './InventoryWasteDetailModal.jsx';
import InventoryItemPhotoPreview from '../InventoryItemPhotoPreview.jsx';
import useInventoryWasteRead from './useInventoryWasteRead.js';
import { employeeDisplayName, formatDate, outletDisplayCode } from './inventoryWasteService.js';

export function wasteActorName(id, people, auth) {
  if (id && (id === auth?.user?.id || id === auth?.profile?.id)) return employeeDisplayName(auth?.profile || { email: auth?.user?.email });
  const person = people.find(row => row.id === id || row.auth_user_id === id);
  return person ? employeeDisplayName(person) : 'Unknown User';
}

// Identity-only entry shared by Wastage and Movement references. RLS governs the read.
export default function InventoryWasteDetail({ wasteId, auth, outlets, onClose }) {
  const read = useInventoryWasteRead({ wasteId, scopeKey: auth?.user?.id || '' });
  const [preview, setPreview] = useState(null);
  if (!read.data) return <Modal title="Waste Record Detail" onClose={onClose}><p role={read.error ? 'alert' : 'status'}>{read.error || 'Loading waste evidence…'}</p>{read.error ? <button className="btn-secondary mt-3" onClick={read.refresh}>Retry</button> : null}</Modal>;
  const waste = read.data.wasteRecords.find(row => row.id === wasteId);
  if (!waste) return <Modal title="Waste Record Detail" onClose={onClose}><p>No accessible waste record found.</p></Modal>;
  const item = read.data.items.find(row => row.id === waste.itemId);
  return <><InventoryWasteDetailModal waste={waste} item={item} category={read.data.categories.find(row => row.id === item?.categoryId)} outlet={outlets.find(row => row.id === waste.outletId)} movement={read.data.movements.find(row => row.referenceId === waste.id)} actorName={wasteActorName(waste.recordedBy, read.data.people, auth)} formatDate={formatDate} outletDisplayCode={outletDisplayCode} onClose={onClose} onPreviewPhoto={setPreview} /><InventoryItemPhotoPreview preview={preview} onClose={() => setPreview(null)} /></>;
}
