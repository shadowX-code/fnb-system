import { useTranslation } from "react-i18next";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { crewLegalContent, crewLegalIntro } from "../content/crewLegalContent.js";

export default function CrewLegalPage({ kind, onBack }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const sections = crewLegalContent[language]?.[kind] || crewLegalContent.en[kind];

  return <section><CrewMobileDetailHeader title={t(`me.${kind}`)} onBack={onBack} />
    <div className="crew-me-legal"><p>{(crewLegalIntro[language] || crewLegalIntro.en)[kind]}</p>
      {sections.map(([heading, body]) => <article className="crew-ui-functional-surface" key={heading}><h2>{heading}</h2><p>{body}</p></article>)}
    </div>
  </section>;
}
