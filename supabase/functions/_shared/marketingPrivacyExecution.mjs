// Deployment does not activate privacy work. Production needs both separately approved gates.
export function privacyProcessingAllowed(production, get) {
  return !production || get('MARKETING_PRIVACY_PROCESSING_ENABLED') === 'true'
    && get('MARKETING_PRIVACY_RETENTION_ENABLED') === 'true';
}
