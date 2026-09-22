export default function FeedXLoadingMark({ label = "Loading" }) {
  return (
    <span className="crew-feedx-loading-mark" role="status" aria-label={label}>
      <img src="/logo-icon.jpg" alt="" draggable="false" />
    </span>
  );
}
