import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { startSession } from "../../../shared/session-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await startSession(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
