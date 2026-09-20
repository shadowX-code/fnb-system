export default function AdminFormField({ label, children, required = false, helper, error, className = "", as: Component = "label" }) {
  return (
    <Component className={`admin-form-field ${className}`}>
      {label ? (
        <span className="admin-form-field-label">
          {label} {required ? <em className="not-italic text-rose-500">*</em> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="admin-form-field-message text-rose-600">{error}</span> : null}
      {!error && helper ? <span className="admin-form-field-message">{helper}</span> : null}
    </Component>
  );
}
