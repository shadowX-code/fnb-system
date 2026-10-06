// One lightweight heading rhythm for Prepare, Review and Finalize content.
export default function PayrollStageHeading({ title, summary }) {
  return <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
    <h3 className="text-base font-bold text-text-primary">{title}</h3>
    <p className="text-sm text-text-secondary">{summary}</p>
  </header>;
}
