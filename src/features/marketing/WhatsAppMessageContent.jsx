import { FileImage, Video, FileText, AudioLines, Paperclip } from 'lucide-react';

const media = {
  image: { label: 'Image', icon: FileImage },
  video: { label: 'Video', icon: Video },
  document: { label: 'Document', icon: FileText },
  audio: { label: 'Audio', icon: AudioLines },
  sticker: { label: 'Sticker', icon: FileImage },
};

export function whatsAppProvenance(message) {
  const historical = message.evidence_source === 'historical_import';
  // Import provenance takes priority over live attribution. An observation is never a send receipt.
  if (historical) return 'Synced history · automation excluded';
  if (message.evidence_source === 'recent_api') return 'Recovered history · automation excluded';
  if (message.kind === 'echo') {
    if (message.message_origin === 'meta') return 'Mobile app reply · outside FeedX';
    if (message.sender_type === 'feedx_staff') return 'Staff reply';
    if (message.sender_type === 'feedx_ai') return 'FeedX AI';
    return 'Outgoing observation · sender unavailable';
  }
  return message.evidence_source === 'signed_webhook' ? 'Live inbound' : 'Incoming message';
}

export default function WhatsAppMessageContent({ message }) {
  // The canonical provider contract deliberately exposes type placeholders, not media IDs,
  // private URLs or downloadable assets. Never invent a browser URL from provider metadata.
  const type = /^\[WhatsApp ([a-z]+)\]$/.exec(message.body || '')?.[1];
  if (!type && (message.body || message.kind !== 'attachment'))
    return <p>{message.body || 'Message content unavailable'}</p>;
  const { label, icon: Icon } = media[type] || { label: type ? 'Unsupported message' : 'Attachment', icon: Paperclip };
  return <div className="inbox-media-placeholder" role="group" aria-label={`${label} · preview unavailable`}>
    <Icon size={24} aria-hidden="true" />
    <div><strong>{label}</strong><p>Preview unavailable</p><small>WhatsApp media is not downloaded by this connection.</small></div>
  </div>;
}
