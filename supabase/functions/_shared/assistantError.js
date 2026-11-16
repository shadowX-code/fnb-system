export class AssistantError extends Error { constructor(code,status=503,diagnostic=null){super(code);this.code=code;this.status=status;this.diagnostic=diagnostic;} }
