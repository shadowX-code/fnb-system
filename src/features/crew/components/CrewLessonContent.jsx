import { useTranslation } from "react-i18next";
import { CircleAlert, FileText, ChevronRight } from "lucide-react";
import CrewRichContent from "./CrewRichContent.jsx";
import CrewLearningImage from "./CrewLearningImage.jsx";
import { plainTextToSopHtml } from "../utils/sopDocumentContent.js";

export function CrewLessonBlocks({ blocks, token, onOpenSop, renderImage }) {
  const { t } = useTranslation();
  const richBlock = (block) => block.payload?.body_html || plainTextToSopHtml(block.payload?.body || block.payload?.text || block.payload?.content || block.payload?.title || "");
  return <>{blocks?.map((block) =>
        block.block_type === "sop_reference" ? (
          <button type="button" key={block.id} disabled={!onOpenSop} className="crew-learning-sop-reference crew-ui-functional-surface" onClick={() => onOpenSop?.(block.payload?.sop_version_id)}>
            <span className="crew-ui-icon-container crew-ui-icon-container--compact"><FileText size={17} /></span><span><strong>{block.payload?.title || t("learn.requiredSop")}</strong><small>{t("learn.version", { version: block.payload?.version || "—" })}{block.payload?.required_acknowledgement ? ` · ${t("learn.acknowledgementRequired")}` : ""}</small></span><ChevronRight size={18} />
          </button>
        ) : (
          <article key={block.id} className={block.block_type === "key_point" ? "crew-learning-content-block crew-ui-note crew-ui-note--mint is-key-point" : "crew-learning-content-block crew-ui-functional-surface"}>{block.block_type === "key_point" && <CircleAlert size={17} aria-hidden="true" />}<span><strong>{block.block_type === "key_point" ? t("tasks.types.key_point") : t("learn.lesson")}</strong><CrewRichContent html={richBlock(block)} />{block.payload?.media ? renderImage ? renderImage(block) : <CrewLearningImage token={token} media={block.payload.media} /> : null}</span></article>
        ),
      )}</>;
}

export function CrewQuizQuestions({ quiz, answers = {}, onChoose, inspectAnswers = false }) {
  const { t } = useTranslation();
  return <>{quiz.questions?.map((question, index) => (
            <fieldset key={question.id}>
              <legend>{index + 1}. {question.prompt}</legend>
              <small>{question.question_type === "multiple_choice" ? t("learn.selectAll") : t("learn.selectOne")}</small>
              {question.options?.map((option) => (
                <label key={option.id} className={answers[question.id]?.includes(option.id) ? "is-selected" : ""}>
                  <input type={question.question_type === "multiple_choice" ? "checkbox" : "radio"} name={question.id} checked={Boolean(answers[question.id]?.includes(option.id))} onChange={() => onChoose?.(question, option.id)} />{option.label}
                {inspectAnswers && option.is_correct && <strong className="crew-preview-correct">Correct answer</strong>}</label>
              ))}
              {inspectAnswers && question.explanation && <p className="crew-preview-explanation"><strong>Explanation: </strong>{question.explanation}</p>}
            </fieldset>
          ))}</>;
}
