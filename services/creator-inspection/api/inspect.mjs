import {verifyVercelOidcToken} from '@vercel/oidc';
import {inspectPublic} from '../runtime/server/creatorExtraction/inspect.mjs';
import {inspectProfile,profileIdentity} from '../runtime/server/creatorExtraction/profiles.mjs';
import {platformUrl} from '../runtime/server/creatorExtraction/urls.mjs';
import {withFunctionTelemetry} from '../runtime/server/functionTelemetry.mjs';
export const config={maxDuration:60};
import {createInspectionHandler} from '../handler.mjs';
import {inspectionBindings} from '../runtime/server/creatorExtraction/bindings.mjs';
export default withFunctionTelemetry('/api/inspect',createInspectionHandler({verifyVercelOidcToken,inspectPublic,inspectProfile,profileIdentity,platformUrl,inspectionBindings}));
