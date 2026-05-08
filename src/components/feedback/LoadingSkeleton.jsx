export default function LoadingSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-2xl bg-slate-100" />
      ))}
    </div>
  );
}
