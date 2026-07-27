import { clientFor, handleFunctionError } from "../../../shared/platform.js";
import { sessionStatus } from "../../../shared/session-service.js";

Deno.serve(async (req) => {
  try { return Response.json(await sessionStatus(clientFor(req), await req.json())); }
  catch (error) { return handleFunctionError(error); }
});
