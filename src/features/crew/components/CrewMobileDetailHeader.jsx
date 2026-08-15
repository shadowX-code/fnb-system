import { ArrowLeft } from "lucide-react";

export default function CrewMobileDetailHeader({ title, onBack, className = "" }) {
  return (
    <header className={`crew-v2-page-header crew-mobile-detail-header ${className}`.trim()}>
      <div>
        <button type="button" onClick={onBack} aria-label="Back">
          <ArrowLeft size={19} />
        </button>
        <h1 title={title}>{title}</h1>
      </div>
    </header>
  );
}
